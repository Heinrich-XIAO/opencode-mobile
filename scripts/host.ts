#!/usr/bin/env bun
/**
 * OpenCode Host Companion CLI
 *
 * Daemon that runs on the machine with OpenCode files.
 * - Subscribes to Convex `requests` table for its hostId
 * - Manages opencode serve processes (one per directory)
 * - Relays messages between Client and opencode serve
 * - Heartbeats to Convex to signal availability
 *
 * Usage: bun run host
 */

import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";
import { randomBytes, createHmac } from "crypto";
import { homedir, platform } from "os";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HostConfig {
  hostId: string;
  convexUrl: string;
  jwtSecret: string;
  opencodePath: string;
  portRange: { min: number; max: number };
  inactivityTimeoutMs: number;
  heartbeatIntervalMs: number;
  basePath: string; // Base directory for browsing (e.g. ~/Documents)
}

interface ActiveProcess {
  path: string;
  port: number;
  pid: number;
  childProcess: ChildProcess;
  startedAt: number;
  lastActivity: number;
}

interface PendingTool {
  toolName: string;
  toolInput: any;
  toolCallId: string;
  sessionId: string;
  port: number;
}

interface SessionSummary {
  id: string;
  title?: string;
  updatedAt?: string;
  status?: string;
}

/** 6-digit OTP generated once on startup and kept in-memory for this process lifetime. */
let startupOtp = "";

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".config", "opencode-host");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const VERSION = "1.0.0";
const PROD_CONVEX_URL = "https://utmost-wren-887.convex.cloud";
const DEV_CONVEX_URL = "https://intent-chinchilla-833.convex.cloud";

const activeProcesses = new Map<string, ActiveProcess>();
const pendingTools = new Map<string, PendingTool>(); // requestId -> PendingTool
let convex: ConvexClient;
let config: HostConfig;

// ---------------------------------------------------------------------------
// Host ID helpers
// ---------------------------------------------------------------------------

/** Generate a 10-digit numeric host ID (e.g. "3847291056") */
function generateHostId(): string {
  // Generate 10 random digits. Use randomBytes to get entropy, convert to digits.
  const bytes = randomBytes(5); // 5 bytes = 40 bits, plenty for 10 digits
  let num = BigInt(`0x${bytes.toString("hex")}`) % 10_000_000_000n;
  return num.toString().padStart(10, "0");
}

function generateStartupOtp(): string {
  const bytes = randomBytes(4);
  const num = Number.parseInt(bytes.toString("hex"), 16) % 1_000_000;
  return num.toString().padStart(6, "0");
}

/** Format a 10-digit host ID for display: "123 456 7890" */
function formatHostId(id: string): string {
  const digits = id.replace(/\D/g, "");
  if (digits.length !== 10) return id; // Fallback for legacy IDs
  return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function loadOrCreateConfig(): HostConfig {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (existsSync(CONFIG_FILE)) {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const stored = JSON.parse(raw);
    // Merge with defaults for any missing fields
    return {
      hostId: stored.hostId || generateHostId(),
      convexUrl:
        stored.convexUrl ||
        process.env.CONVEX_URL ||
        PROD_CONVEX_URL,
      jwtSecret: stored.jwtSecret || randomBytes(32).toString("base64"),
      opencodePath: stored.opencodePath || "opencode",
      portRange: stored.portRange || { min: 4096, max: 8192 },
      inactivityTimeoutMs: stored.inactivityTimeoutMs || 60000,
      heartbeatIntervalMs: stored.heartbeatIntervalMs || 30000,
      basePath: stored.basePath || join(homedir(), "Documents"),
    };
  }

  // First run: generate everything
  const newConfig: HostConfig = {
    hostId: generateHostId(),
    convexUrl:
      process.env.CONVEX_URL ||
      PROD_CONVEX_URL,
    jwtSecret: randomBytes(32).toString("base64"),
    opencodePath: "opencode",
    portRange: { min: 4096, max: 8192 },
    inactivityTimeoutMs: 60000,
    heartbeatIntervalMs: 30000,
    basePath: join(homedir(), "Documents"),
  };

  writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  console.log(`[config] Created new config at ${CONFIG_FILE}`);
  return newConfig;
}

// ---------------------------------------------------------------------------
// JWT (simple HMAC-based)
// ---------------------------------------------------------------------------

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(data: string): string {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function createJwt(
  payload: Record<string, unknown>,
  secret: string
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${body}.${signature}`;
}

function verifyJwt(
  token: string,
  secret: string,
  options?: { allowExpired?: boolean }
): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const expectedSig = createHmac("sha256", secret)
      .update(`${header}.${body}`)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    if (sig !== expectedSig) return null;

    const payload = JSON.parse(base64UrlDecode(body));

    // Check expiration
    if (!options?.allowExpired && payload.exp && Date.now() / 1000 > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function isJwtBeyondGrace(payload: Record<string, unknown>, graceMs: number): boolean {
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  if (!exp) return false;
  return Date.now() > exp + graceMs;
}

// ---------------------------------------------------------------------------
// Port management
// ---------------------------------------------------------------------------

async function findAvailablePort(min: number, max: number): Promise<number> {
  // Check which ports are already in use by our processes
  const usedPorts = new Set(
    Array.from(activeProcesses.values()).map((p) => p.port)
  );

  for (let port = min; port <= max; port++) {
    if (usedPorts.has(port)) continue;

    // Try to bind to the port to check availability
    try {
      const server = Bun.serve({
        port,
        hostname: "127.0.0.1",
        fetch() {
          return new Response("check");
        },
      });
      server.stop();
      return port;
    } catch {
      continue;
    }
  }
  throw new Error(`No available ports in range ${min}-${max}`);
}

// ---------------------------------------------------------------------------
// Filesystem scanning
// ---------------------------------------------------------------------------

function listDirectories(basePath: string, requestedPath: string): string[] {
  // Resolve the full path safely
  const fullPath = resolve(basePath, requestedPath.replace(/^\/+/, ""));

  // Security: ensure we don't escape basePath
  if (!fullPath.startsWith(basePath)) {
    throw new Error("Access denied: path outside base directory");
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Directory not found: ${requestedPath}`);
  }

  try {
    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch (err) {
    throw new Error(
      `Cannot read directory: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function normalizeSessionsPayload(payload: unknown): SessionSummary[] {
  const toSummary = (value: unknown, fallbackId?: string): SessionSummary | null => {
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    const id =
      typeof obj.id === "string"
        ? obj.id
        : typeof obj.sessionID === "string"
          ? obj.sessionID
          : fallbackId;
    if (!id) return null;

    const title = typeof obj.title === "string" ? obj.title : undefined;
    const updatedAtRaw =
      typeof obj.updatedAt === "number" || typeof obj.updatedAt === "string"
        ? obj.updatedAt
        : typeof obj.lastActivity === "number"
          ? obj.lastActivity
          : undefined;
    const status =
      typeof obj.status === "string"
        ? obj.status
        : obj.status && typeof obj.status === "object"
          ? String((obj.status as Record<string, unknown>).type ?? "")
          : undefined;

    return {
      id,
      title,
      updatedAt: updatedAtRaw !== undefined ? String(updatedAtRaw) : undefined,
      status,
    };
  };

  if (Array.isArray(payload)) {
    return payload
      .map((item) => toSummary(item))
      .filter((item): item is SessionSummary => item !== null);
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const obj = payload as Record<string, unknown>;
  if (Array.isArray(obj.sessions)) {
    return obj.sessions
      .map((item) => toSummary(item))
      .filter((item): item is SessionSummary => item !== null);
  }

  return Object.entries(obj)
    .map(([id, value]) => toSummary(value, id))
    .filter((item): item is SessionSummary => item !== null);
}

async function getOpencodeSessions(port: number): Promise<SessionSummary[]> {
  const errors: string[] = [];

  try {
    const res = await fetch(`http://127.0.0.1:${port}/session`, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      throw new Error(`GET /session returned ${res.status}`);
    }

    const payload = (await res.json()) as unknown;
    return normalizeSessionsPayload(payload);
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  try {
    const statusRes = await fetch(`http://127.0.0.1:${port}/session/status`, {
      headers: { Accept: "application/json" },
    });

    if (!statusRes.ok) {
      throw new Error(`GET /session/status returned ${statusRes.status}`);
    }

    const payload = (await statusRes.json()) as unknown;
    const statusObj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    return Object.entries(statusObj).map(([id, value]) => {
      const status =
        value && typeof value === "object" && (value as Record<string, unknown>).type
          ? String((value as Record<string, unknown>).type)
          : undefined;
      return { id, status };
    });
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  throw new Error(`Unable to list sessions (${errors.join("; ")})`);
}

// ---------------------------------------------------------------------------
// OpenCode Serve Process Management
// ---------------------------------------------------------------------------

async function waitForOpencodeReady(
  port: number,
  timeoutMs = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`opencode serve failed to start on port ${port} within ${timeoutMs}ms`);
}

async function startOpencodeServe(directory: string): Promise<{ port: number; pid: number }> {
  // Check if directory already active
  if (activeProcesses.has(directory)) {
    const existing = activeProcesses.get(directory)!;
    existing.lastActivity = Date.now();
    return { port: existing.port, pid: existing.pid };
  }

  // Find available port
  const port = await findAvailablePort(
    config.portRange.min,
    config.portRange.max
  );

  console.log(
    `[process] Starting opencode serve for ${directory} on port ${port}`
  );

  // Spawn the process
  const child = spawn(
    config.opencodePath,
    ["serve", "--port", port.toString(), "--hostname", "127.0.0.1"],
    {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    }
  );

  // Log stdout/stderr
  child.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.log(`[opencode:${port}] ${line}`);
    }
  });
  child.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().trim().split("\n");
    for (const line of lines) {
      console.error(`[opencode:${port}] ${line}`);
    }
  });

  // Track the process
  const processInfo: ActiveProcess = {
    path: directory,
    port,
    pid: child.pid!,
    childProcess: child,
    startedAt: Date.now(),
    lastActivity: Date.now(),
  };
  activeProcesses.set(directory, processInfo);

  // Handle process exit
  child.on("exit", (code) => {
    console.log(
      `[process] opencode serve on port ${port} exited with code ${code}`
    );
    activeProcesses.delete(directory);
    updateHostStatus();
  });

  // Wait for it to be ready
  try {
    await waitForOpencodeReady(port);
    console.log(`[process] opencode serve ready on port ${port}`);
  } catch (err) {
    // Kill the process if it didn't start in time
    child.kill("SIGTERM");
    activeProcesses.delete(directory);
    throw err;
  }

  // Update Convex with new active directory
  await updateHostStatus();

  return { port, pid: child.pid! };
}

async function stopOpencodeServe(directory: string): Promise<void> {
  const proc = activeProcesses.get(directory);
  if (!proc) return;

  console.log(`[process] Stopping opencode serve for ${directory}`);

  // Graceful shutdown
  proc.childProcess.kill("SIGTERM");

  // Wait up to 5s for graceful exit
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (!proc.childProcess.killed) {
        proc.childProcess.kill("SIGKILL");
      }
      resolve();
    }, 5000);

    proc.childProcess.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  activeProcesses.delete(directory);
  relaySessions.delete(directory); // Clear cached relay session for this directory
  await updateHostStatus();
}

// ---------------------------------------------------------------------------
// Message Relay (SSE Streaming)
// ---------------------------------------------------------------------------

// Store dedicated relay session IDs per directory to avoid colliding with TUI sessions
const relaySessions = new Map<string, string>();

async function getOrCreateSession(
  port: number,
  directory: string,
  preferredSessionId?: string
): Promise<string> {
  if (preferredSessionId) {
    return preferredSessionId;
  }

  // Check if we already have a relay session for this directory
  const existing = relaySessions.get(directory);
  if (existing) {
    // Verify it still exists and is idle
    try {
      const statusRes = await fetch(
        `http://127.0.0.1:${port}/session/status`,
        {
          headers: { Accept: "application/json" },
        }
      );
      if (statusRes.ok) {
        const statuses = await statusRes.json();
        const sessionStatus = statuses[existing];
        if (sessionStatus) {
          // Session exists — check if idle
          if (sessionStatus.type === "idle") {
            return existing;
          }
          // If busy, wait a moment and try again or create new
          console.log(
            `[relay] Existing relay session ${existing} is busy, creating new one`
          );
        }
        // Session no longer exists on this server instance — create new
      }
    } catch {
      // Fall through to create
    }
  }

  // Always create a fresh session for relay use
  const createRes = await fetch(`http://127.0.0.1:${port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Remote relay" }),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create session: ${createRes.status}`);
  }
  const created = await createRes.json();
  const newId = created.id;
  relaySessions.set(directory, newId);
  console.log(
    `[relay] Created dedicated relay session ${newId} for ${directory}`
  );
  return newId;
}

/**
 * Poll for tool result from client and submit it to opencode serve.
 * Returns true if result was submitted successfully.
 */
async function pollAndSubmitToolResult(
  requestId: string,
  port: number,
  sessionId: string,
  timeoutMs: number = 300000 // 5 minutes default
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    // Check if tool result has been submitted
    const toolStatus = await convex.query(api.requests.getToolStatus, {
      requestId: requestId as any,
    });
    
    if (toolStatus?.toolResult) {
      console.log(`[relay] Tool result received, submitting to opencode`);
      
      // Submit tool result to opencode serve
      const response = await fetch(
        `http://127.0.0.1:${port}/session/${sessionId}/tool`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toolCallId: toolStatus.toolResult.toolCallId,
            result: toolStatus.toolResult.result,
          }),
        }
      );
      
      if (response.ok) {
        console.log(`[relay] Tool result submitted successfully`);
        pendingTools.delete(requestId);
        return true;
      } else {
        console.error(`[relay] Failed to submit tool result: ${response.status}`);
        return false;
      }
    }
    
    // Wait before polling again
    await new Promise((r) => setTimeout(r, 500));
  }
  
  console.log(`[relay] Timed out waiting for tool result`);
  return false;
}

/**
 * Stream a relay message using SSE events from opencode serve.
 * Sends prompt_async, then listens to /event SSE for text deltas,
 * pushing partial text to Convex in real-time.
 * Returns the final complete response text.
 */
async function relayMessageStreaming(
  port: number,
  message: string,
  requestId: string,
  directory: string,
  onActivity?: () => void,
  model?: { providerID: string; modelID: string },
  preferredSessionId?: string
): Promise<{ aiResponse: string; reasoning: string }> {
  const sessionId = await getOrCreateSession(port, directory, preferredSessionId);
  console.log(`[relay] Using session ${sessionId}`);

  // Connect to SSE before sending the prompt so we don't miss events
  const sseUrl = `http://127.0.0.1:${port}/event`;
  const abortController = new AbortController();

  let accumulatedText = "";
  let accumulatedReasoning = "";
  let assistantMessageId: string | null = null;
  let completed = false;
  let lastPushTime = 0;
  const PUSH_INTERVAL_MS = 150; // Throttle Convex updates to avoid rate limits
  const partKinds = new Map<string, "text" | "reasoning">();
  const addedParts = new Set<string>(); // Track which parts have been added to Convex

  // Track pending push to avoid overlapping mutations
  let pushPending = false;

  // Add a new part to Convex for separate bubble rendering
  async function addPartToConvex(
    partType: "reasoning" | "text" | "tool",
    content: string,
    metadata?: any
  ) {
    try {
      await convex.mutation(api.requests.addMessagePart, {
        requestId: requestId as any,
        partType,
        content,
        metadata,
      });
    } catch (err) {
      console.error(`[relay] Failed to add part: ${err}`);
    }
  }

  async function pushPartialToConvex(force = false) {
    const now = Date.now();
    if (pushPending) return;
    if (!force && now - lastPushTime < PUSH_INTERVAL_MS) return;
    if (!accumulatedText && !accumulatedReasoning) return;

    pushPending = true;
    lastPushTime = now;
    try {
      await convex.mutation(api.requests.updatePartialResponse, {
        requestId: requestId as any,
        text: accumulatedText || undefined,
        reasoning: accumulatedReasoning || undefined,
      });
    } catch (err) {
      // Non-fatal: client will still get the final response
      console.error(`[relay] Failed to push partial: ${err}`);
    }
    pushPending = false;
  }

  // Set up a periodic pusher to batch delta updates
  const pushInterval = setInterval(() => {
    if (accumulatedText && !completed) {
      pushPartialToConvex();
    }
  }, PUSH_INTERVAL_MS);

  return new Promise<{ aiResponse: string; reasoning: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      abortController.abort();
      clearInterval(pushInterval);
      reject(new Error("Timed out waiting for AI response (180s)"));
    }, 180000);

    // Start SSE listener
    fetch(sseUrl, {
      signal: abortController.signal,
      headers: { Accept: "text/event-stream" },
    })
      .then(async (res) => {
        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Now that SSE is connected, send the prompt
        const promptBody: any = {
          parts: [{ type: "text", text: message }],
        };
        if (model) {
          promptBody.model = {
            providerID: model.providerID,
            modelID: model.modelID,
          };
        }

        const asyncRes = await fetch(
          `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(promptBody),
          }
        );

        if (!asyncRes.ok && asyncRes.status !== 204) {
          const errBody = await asyncRes.text();
          console.error(`[relay] prompt_async error body: ${errBody}`);
          throw new Error(`prompt_async returned ${asyncRes.status}: ${errBody}`);
        }

        console.log(`[relay] Message sent, streaming response...`);

        // Read SSE events
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;

            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case "message.part.delta": {
                  // Streaming delta for response or reasoning
                  if (event.properties?.delta && event.properties?.sessionID === sessionId) {
                    const delta = String(event.properties.delta);
                    const partId = event.properties.partID ? String(event.properties.partID) : null;

                    const rawType =
                      event.properties?.part?.type ??
                      event.properties?.type ??
                      event.properties?.partType ??
                      null;
                    const normalizedType =
                      typeof rawType === "string" ? rawType.toLowerCase() : "";

                    const partKind =
                      (partId ? partKinds.get(partId) : undefined) ||
                      (normalizedType.includes("reasoning") || normalizedType.includes("thinking")
                        ? "reasoning"
                        : "text");

                    if (partKind === "reasoning") {
                      accumulatedReasoning += delta;
                    } else {
                      accumulatedText += delta;
                    }

                    if (partId && !partKinds.has(partId)) {
                      partKinds.set(partId, partKind);
                    }
                    // Keep the process alive while streaming
                    onActivity?.();
                  }
                  break;
                }

                case "message.part.added": {
                  if (event.properties?.sessionID === sessionId) {
                    const partId = event.properties?.partID ?? event.properties?.part?.id;
                    const rawType =
                      event.properties?.part?.type ??
                      event.properties?.type ??
                      event.properties?.partType ??
                      null;
                    if (partId && typeof rawType === "string") {
                      const normalizedType = rawType.toLowerCase();
                      let partKind: "reasoning" | "text" = "text";
                      if (
                        normalizedType.includes("reasoning") ||
                        normalizedType.includes("thinking")
                      ) {
                        partKind = "reasoning";
                        partKinds.set(String(partId), "reasoning");
                      } else {
                        partKinds.set(String(partId), "text");
                      }

                      // Add part to Convex for separate bubble rendering (if not already added)
                      const partKey = `${sessionId}-${partId}`;
                      if (!addedParts.has(partKey)) {
                        addedParts.add(partKey);
                        await addPartToConvex(partKind, "");
                      }
                    }
                  }
                  break;
                }

                case "message.updated": {
                  // Track the assistant message ID
                  const info = event.properties?.info;
                  if (
                    info?.role === "assistant" &&
                    info?.sessionID === sessionId
                  ) {
                    assistantMessageId = info.id;
                  }
                  break;
                }

                case "session.status": {
                  // Check if our session went idle (done)
                  if (
                    event.properties?.sessionID === sessionId &&
                    event.properties?.status?.type === "idle"
                  ) {
                    completed = true;
                    // Final push
                    await pushPartialToConvex(true);
                    clearTimeout(timeout);
                    clearInterval(pushInterval);
                    abortController.abort();

                    const finalText = accumulatedText || "(No response)";
                    console.log(
                      `[relay] Stream complete, ${finalText.length} chars`
                    );
                    resolve({ aiResponse: finalText, reasoning: accumulatedReasoning });
                    return;
                  }
                  break;
                }

                case "tool.invoke": {
                  // AI wants to use a tool - store it and wait for user response
                  const toolCallId = event.properties?.toolCallId;
                  const toolName = event.properties?.toolName;
                  const toolInput = event.properties?.input;
                  
                  if (toolCallId && toolName) {
                    console.log(`[relay] Tool invoked: ${toolName} (call: ${toolCallId})`);
                    
                    // Add tool part to Convex for separate bubble rendering (BEFORE waiting for result)
                    const toolPartKey = `tool-${toolCallId}`;
                    if (!addedParts.has(toolPartKey)) {
                      addedParts.add(toolPartKey);
                      await addPartToConvex(
                        "tool",
                        `Using tool: ${toolName}`,
                        { toolName, toolInput, toolCallId }
                      );
                    }
                    
                    // Store pending tool in Convex for client to see
                    await convex.mutation(api.requests.setPendingTool, {
                      requestId: requestId as any,
                      toolName,
                      toolInput,
                      toolCallId,
                    });
                    
                    // Track locally
                    pendingTools.set(requestId, {
                      toolName,
                      toolInput,
                      toolCallId,
                      sessionId,
                      port,
                    });
                    
                    // Pause streaming - poll for tool result and submit it
                    console.log(`[relay] Pausing for tool result: ${toolCallId}`);
                    const resultSubmitted = await pollAndSubmitToolResult(requestId, port, sessionId);
                    
                    if (!resultSubmitted) {
                      console.error(`[relay] Failed to get/submit tool result`);
                    }
                    
                    // Resume streaming - continue reading SSE events
                    console.log(`[relay] Resuming stream after tool result`);
                  }
                  break;
                }

                case "tool.result": {
                  // Tool result received (shouldn't happen here - we handle results via polling)
                  console.log(`[relay] Tool result event received`);
                  break;
                }
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        // If we reach here without completing, fetch the response traditionally
        if (!completed) {
          clearTimeout(timeout);
          clearInterval(pushInterval);
          const finalText = accumulatedText || "(No response)";
          resolve({ aiResponse: finalText, reasoning: accumulatedReasoning });
        }
      })
      .catch((err) => {
        clearTimeout(timeout);
        clearInterval(pushInterval);
        if (err.name === "AbortError" && completed) {
          // Expected — we aborted after completion
          return;
        }
        reject(err);
      });
  });
}

// ---------------------------------------------------------------------------
// Request Processing
// ---------------------------------------------------------------------------

async function handleAuthenticate(request: any): Promise<void> {
  const { otp } = request.payload;

  if (!otp) {
    throw new Error("Missing otp");
  }

  if (otp.trim() !== startupOtp) {
    throw new Error("Invalid OTP");
  }

  // Generate JWT
  const now = Math.floor(Date.now() / 1000);
  const jwt = createJwt(
    {
      sub: "host-authentication",
      hostId: config.hostId,
      directories: [], // Will be populated as user accesses directories
      iat: now,
      exp: now + 30 * 24 * 60 * 60, // 30 days
    },
    config.jwtSecret
  );

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { jwtToken: jwt },
  });

  console.log(`[auth] Authenticated client ${request.clientId}`);
}

async function handleRefreshJwt(request: any): Promise<void> {
  if (!request.jwt) throw new Error("Missing JWT");
  const claims = verifyJwt(request.jwt, config.jwtSecret, { allowExpired: true });
  if (!claims) throw new Error("Invalid JWT");

  if (isJwtBeyondGrace(claims, 24 * 60 * 60 * 1000)) {
    throw new Error("JWT expired");
  }

  const now = Math.floor(Date.now() / 1000);
  const { exp: _exp, iat: _iat, ...rest } = claims as Record<string, unknown>;
  const refreshed = createJwt(
    {
      ...rest,
      iat: now,
      exp: now + 30 * 24 * 60 * 60,
    },
    config.jwtSecret
  );

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { jwtToken: refreshed },
  });

  console.log(`[auth] Refreshed JWT for host ${config.hostId}`);
}

async function handleListDirs(request: any): Promise<void> {
  // Validate JWT
  if (!request.jwt) throw new Error("Missing JWT");
  const claims = verifyJwt(request.jwt, config.jwtSecret);
  if (!claims) throw new Error("Invalid or expired JWT");

  const requestedPath = request.payload.path || "/";
  const dirs = listDirectories(config.basePath, requestedPath);

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { directories: dirs },
  });

  console.log(
    `[fs] Listed ${dirs.length} directories at ${requestedPath}`
  );
}

async function handleStartOpencode(request: any): Promise<void> {
  // Validate JWT
  if (!request.jwt) throw new Error("Missing JWT");
  const claims = verifyJwt(request.jwt, config.jwtSecret);
  if (!claims) throw new Error("Invalid or expired JWT");

  const directory = request.payload.directory;
  if (!directory) throw new Error("Missing directory");

  // Resolve full path
  const fullPath = resolve(config.basePath, directory.replace(/^\/+/, ""));

  // Security check
  if (!fullPath.startsWith(config.basePath)) {
    throw new Error("Access denied: path outside base directory");
  }

  if (!existsSync(fullPath)) {
    throw new Error(`Directory not found: ${directory}`);
  }

  const { port, pid } = await startOpencodeServe(fullPath);

  let sessionsJson: string | undefined;
  try {
    const sessions = await getOpencodeSessions(port);
    sessionsJson = JSON.stringify(sessions.slice(0, 50));
    console.log(`[sessions] Found ${sessions.length} sessions on port ${port}`);
  } catch (err) {
    console.warn(
      `[sessions] Failed to list sessions on port ${port}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { port, pid, sessionsJson },
  });

  console.log(
    `[process] Started opencode serve for ${directory} → port ${port}, pid ${pid}`
  );
}

async function handleStopOpencode(request: any): Promise<void> {
  // Validate JWT
  if (!request.jwt) throw new Error("Missing JWT");
  const claims = verifyJwt(request.jwt, config.jwtSecret);
  if (!claims) throw new Error("Invalid or expired JWT");

  const directory = request.payload.directory;
  if (!directory) throw new Error("Missing directory");

  const fullPath = resolve(config.basePath, directory.replace(/^\/+/, ""));
  await stopOpencodeServe(fullPath);

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: {},
  });
}

async function handleRelayMessage(request: any): Promise<void> {
  // Validate JWT
  if (!request.jwt) throw new Error("Missing JWT");
  const claims = verifyJwt(request.jwt, config.jwtSecret);
  if (!claims) throw new Error("Invalid or expired JWT");

  const { message, port: requestedPort, directory, providerID, modelID, sessionId } = request.payload;
  if (!message) throw new Error("Missing message");
  if (!requestedPort) throw new Error("Missing port");

  // Verify we have an active process on that port, or auto-restart if killed
  let activePort = requestedPort;
  let found = false;
  for (const proc of activeProcesses.values()) {
    if (proc.port === requestedPort) {
      proc.lastActivity = Date.now();
      found = true;
      break;
    }
  }

  if (!found && directory) {
    // Process was killed (e.g. by inactivity timer) — auto-restart it
    const fullPath = resolve(config.basePath, directory.replace(/^\//, ""));
    console.log(`[relay] Auto-restarting opencode serve for ${fullPath} (was on port ${requestedPort})`);
    const result = await startOpencodeServe(fullPath);
    activePort = result.port;
    console.log(`[relay] Restarted on port ${activePort}`);
    found = true;
  }

  if (!found) {
    throw new Error(`No active opencode serve on port ${requestedPort}`);
  }

  // Pass activity callback to keep inactivity checker from killing the process during streaming
  const activityCallback = () => {
    for (const proc of activeProcesses.values()) {
      if (proc.port === activePort) {
        proc.lastActivity = Date.now();
        break;
      }
    }
  };

  const modelSelection = providerID && modelID ? { providerID, modelID } : undefined;
  const relayDirectory = directory || "unknown";
  const { aiResponse, reasoning } = await relayMessageStreaming(
    activePort,
    message,
    request._id,
    relayDirectory,
    activityCallback,
    modelSelection,
    sessionId
  );

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { aiResponse, reasoning: reasoning || undefined },
  });

  console.log(`[relay] Streamed message, got ${aiResponse.length} char response`);
}

async function handleGetProviders(request: any): Promise<void> {
  const port = request.payload?.port;
  if (!port) throw new Error("Missing port");

  // Fetch providers from the opencode serve instance
  const res = await fetch(`http://127.0.0.1:${port}/provider`);
  if (!res.ok) throw new Error(`Failed to get providers: ${res.status}`);
  const data = await res.json();

  // Extract connected providers with their models (simplified for client)
  const connected = (data.connected || []) as string[];
  const allProviders = (data.all || []) as any[];

  const providers = allProviders
    .filter((p: any) => connected.includes(p.id))
    .map((p: any) => ({
      id: p.id,
      name: p.name,
      models: Object.values(p.models || {}).map((m: any) => ({
        id: m.id,
        name: m.name,
        providerID: m.providerID,
      })),
    }));

  // Also get the default model info
  const configRes = await fetch(`http://127.0.0.1:${port}/config/providers`);
  let defaultModel: any = null;
  if (configRes.ok) {
    const configData = await configRes.json();
    defaultModel = configData.default || null;
  }

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: {
      providersJson: JSON.stringify({ providers, default: defaultModel }),
    },
  });

  console.log(`[providers] Returned ${providers.length} connected providers`);
}

async function processRequest(request: any): Promise<void> {
  // Mark as processing
  await convex.mutation(api.requests.markProcessing, {
    requestId: request._id,
  });

  try {
    switch (request.type) {
      case "authenticate":
        await handleAuthenticate(request);
        break;
      case "refresh_jwt":
        await handleRefreshJwt(request);
        break;
      case "list_dirs":
        await handleListDirs(request);
        break;
      case "start_opencode":
        await handleStartOpencode(request);
        break;
      case "stop_opencode":
        await handleStopOpencode(request);
        break;
      case "relay_message":
        await handleRelayMessage(request);
        break;
      case "get_providers":
        await handleGetProviders(request);
        break;
      default:
        throw new Error(`Unknown request type: ${request.type}`);
    }
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : String(error);
    console.error(`[error] Request ${request._id} failed: ${errorMsg}`);
    await convex.mutation(api.requests.markFailed, {
      requestId: request._id,
      error: errorMsg,
    });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat & Status
// ---------------------------------------------------------------------------

async function updateHostStatus(): Promise<void> {
  const dirs = Array.from(activeProcesses.values()).map((p) => ({
    path: p.path,
    port: p.port,
    pid: p.pid,
    startedAt: p.startedAt,
    lastActivity: p.lastActivity,
  }));

  try {
    await convex.mutation(api.hosts.updateStatus, {
      hostId: config.hostId,
      status: "online",
      activeDirectories: dirs,
      version: VERSION,
      platform: platform(),
    });
  } catch (err) {
    console.error(
      `[heartbeat] Failed to update status: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function startHeartbeat(): NodeJS.Timer {
  return setInterval(async () => {
    await updateHostStatus();
  }, config.heartbeatIntervalMs);
}

// ---------------------------------------------------------------------------
// Inactivity Checker
// ---------------------------------------------------------------------------

function startInactivityChecker(): NodeJS.Timer {
  return setInterval(async () => {
    const now = Date.now();

    for (const [directory, proc] of activeProcesses.entries()) {
      if (now - proc.lastActivity > config.inactivityTimeoutMs) {
        console.log(
          `[cleanup] Killing inactive opencode serve: ${directory} (idle ${Math.round((now - proc.lastActivity) / 1000)}s)`
        );
        await stopOpencodeServe(directory);
      }
    }
  }, 10000); // Check every 10 seconds
}

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function shutdown(): Promise<void> {
  console.log("\n[shutdown] Stopping all opencode serve instances...");

  const promises = Array.from(activeProcesses.keys()).map((dir) =>
    stopOpencodeServe(dir)
  );
  await Promise.all(promises);

  // Mark offline
  try {
    await convex.mutation(api.hosts.markOffline, {
      hostId: config.hostId,
    });
  } catch {
    // Best effort
  }

  console.log("[shutdown] Done.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Help & Usage
// ---------------------------------------------------------------------------

function showHelp() {
  console.log(`OpenCode Host Companion v${VERSION}

Usage: bun run host [options]

Options:
  -h, --help     Show this help message
  -v, --version  Show version number
  --dev          Use development Convex deployment

Description:
  Daemon that runs on the machine with OpenCode files.
  - Subscribes to Convex 'requests' table for its hostId
  - Manages opencode serve processes (one per directory)
  - Relays messages between Client and opencode serve
  - Heartbeats to Convex to signal availability

Configuration:
  Config is stored at: ~/.config/opencode-host/config.json

Environment Variables:
  CONVEX_URL     Override the Convex backend URL (highest priority)
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const useDev = args.includes("--dev");

  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    process.exit(0);
  }

  console.log("======================================");
  console.log("  OpenCode Host Companion v" + VERSION);
  console.log("======================================\n");

  // 1. Load config
  config = loadOrCreateConfig();
  startupOtp = generateStartupOtp();
  const selectedDefaultConvexUrl = useDev ? DEV_CONVEX_URL : PROD_CONVEX_URL;
  config.convexUrl = process.env.CONVEX_URL || selectedDefaultConvexUrl;

  console.log(`[config] Host ID: ${formatHostId(config.hostId)}`);
  console.log(`[config] Mode: ${useDev ? "dev" : "prod"}`);
  console.log(`[config] Convex URL: ${config.convexUrl}`);
  console.log(`[config] Base path: ${config.basePath}`);
  console.log(`[config] Port range: ${config.portRange.min}-${config.portRange.max}`);
  console.log(`[config] Inactivity timeout: ${config.inactivityTimeoutMs / 1000}s`);
  console.log();

  // 2. Connect to Convex
  convex = new ConvexClient(config.convexUrl);
  console.log("[convex] Connected to Convex");

  // 3. Register as online
  await updateHostStatus();
  console.log("[status] Registered as online");

  // 4. Start heartbeat
  startHeartbeat();
  console.log("[heartbeat] Started (every " + config.heartbeatIntervalMs / 1000 + "s)");

  // 5. Start inactivity checker
  startInactivityChecker();
  console.log("[cleanup] Inactivity checker started");

  // 6. Subscribe to pending requests
  console.log("[requests] Watching for requests...\n");
  console.log("─────────────────────────────────────");
  console.log("  Copy this Host ID to connect:");
  console.log(`  ${formatHostId(config.hostId)}`);
  console.log("  OTP (One time password):");
  console.log(`  ${startupOtp}`);
  console.log("─────────────────────────────────────\n");

  // Track already-processed request IDs to avoid double processing
  const processedIds = new Set<string>();

  convex.onUpdate(
    api.requests.getPendingForHost,
    { hostId: config.hostId },
    (requests) => {
      if (!requests || requests.length === 0) return;

      for (const request of requests) {
        const id = request._id as string;
        if (processedIds.has(id)) continue;
        processedIds.add(id);

        console.log(
          `[request] ${request.type} from client ${request.clientId}`
        );
        processRequest(request).catch((err) => {
          console.error(
            `[error] Unhandled error processing request: ${err}`
          );
        });
      }

      // Cleanup old IDs (keep last 1000)
      if (processedIds.size > 1000) {
        const arr = Array.from(processedIds);
        for (let i = 0; i < arr.length - 500; i++) {
          processedIds.delete(arr[i]);
        }
      }
    }
  );

  // 7. Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // 8. Keep running
  await new Promise(() => {}); // Block forever
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
