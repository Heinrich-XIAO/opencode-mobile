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

// ---------------------------------------------------------------------------
// Globals
// ---------------------------------------------------------------------------

const CONFIG_DIR = join(homedir(), ".config", "opencode-host");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const VERSION = "1.0.0";

const activeProcesses = new Map<string, ActiveProcess>();
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
        "https://intent-chinchilla-833.convex.cloud",
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
      "https://intent-chinchilla-833.convex.cloud",
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
  secret: string
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
    if (payload.exp && Date.now() / 1000 > payload.exp) return null;

    return payload;
  } catch {
    return null;
  }
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
  await updateHostStatus();
}

// ---------------------------------------------------------------------------
// Message Relay (SSE Streaming)
// ---------------------------------------------------------------------------

async function getOrCreateSession(port: number): Promise<string> {
  try {
    const listRes = await fetch(`http://127.0.0.1:${port}/session`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (listRes.ok) {
      const sessions = await listRes.json();
      if (Array.isArray(sessions) && sessions.length > 0) {
        return sessions[0].id;
      }
    }
  } catch {
    // Fall through to create
  }

  const createRes = await fetch(`http://127.0.0.1:${port}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!createRes.ok) {
    throw new Error(`Failed to create session: ${createRes.status}`);
  }
  const created = await createRes.json();
  return created.id;
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
  onActivity?: () => void
): Promise<string> {
  const sessionId = await getOrCreateSession(port);
  console.log(`[relay] Using session ${sessionId}`);

  // Connect to SSE before sending the prompt so we don't miss events
  const sseUrl = `http://127.0.0.1:${port}/event`;
  const abortController = new AbortController();

  let accumulatedText = "";
  let assistantMessageId: string | null = null;
  let textPartId: string | null = null;
  let completed = false;
  let lastPushTime = 0;
  const PUSH_INTERVAL_MS = 150; // Throttle Convex updates to avoid rate limits

  // Track pending push to avoid overlapping mutations
  let pushPending = false;

  async function pushPartialToConvex(force = false) {
    const now = Date.now();
    if (pushPending) return;
    if (!force && now - lastPushTime < PUSH_INTERVAL_MS) return;
    if (!accumulatedText) return;

    pushPending = true;
    lastPushTime = now;
    try {
      await convex.mutation(api.requests.updatePartialResponse, {
        requestId: requestId as any,
        text: accumulatedText,
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

  return new Promise<string>((resolve, reject) => {
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
        const asyncRes = await fetch(
          `http://127.0.0.1:${port}/session/${sessionId}/prompt_async`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parts: [{ type: "text", text: message }],
            }),
          }
        );

        if (!asyncRes.ok && asyncRes.status !== 204) {
          throw new Error(`prompt_async returned ${asyncRes.status}`);
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
                  // Text streaming delta
                  if (event.properties?.delta && event.properties?.sessionID === sessionId) {
                    accumulatedText += event.properties.delta;
                    if (!textPartId) {
                      textPartId = event.properties.partID;
                    }
                    // Keep the process alive while streaming
                    onActivity?.();
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
                    resolve(finalText);
                    return;
                  }
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
          resolve(finalText);
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
  const { sessionCode, otpAttempt } = request.payload;

  if (!sessionCode || !otpAttempt) {
    throw new Error("Missing sessionCode or otpAttempt");
  }

  // Validate OTP against Convex session
  const sessionId = await convex.query(api.sessions.validate, {
    code: sessionCode,
    password: otpAttempt,
  });

  if (!sessionId) {
    throw new Error("Invalid session code or OTP");
  }

  // Generate JWT
  const now = Math.floor(Date.now() / 1000);
  const jwt = createJwt(
    {
      sub: "host-authentication",
      hostId: config.hostId,
      sessionCode,
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

  console.log(`[auth] Authenticated session ${sessionCode}`);
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

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { port, pid },
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

  const { message, port } = request.payload;
  if (!message) throw new Error("Missing message");
  if (!port) throw new Error("Missing port");

  // Verify we have an active process on that port
  let found = false;
  for (const proc of activeProcesses.values()) {
    if (proc.port === port) {
      proc.lastActivity = Date.now();
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`No active opencode serve on port ${port}`);
  }

  // Pass activity callback to keep inactivity checker from killing the process during streaming
  const activityCallback = () => {
    for (const proc of activeProcesses.values()) {
      if (proc.port === port) {
        proc.lastActivity = Date.now();
        break;
      }
    }
  };

  const aiResponse = await relayMessageStreaming(port, message, request._id, activityCallback);

  await convex.mutation(api.requests.markCompleted, {
    requestId: request._id,
    response: { aiResponse },
  });

  console.log(`[relay] Streamed message, got ${aiResponse.length} char response`);
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
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("======================================");
  console.log("  OpenCode Host Companion v" + VERSION);
  console.log("======================================\n");

  // 1. Load config
  config = loadOrCreateConfig();
  console.log(`[config] Host ID: ${formatHostId(config.hostId)}`);
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
