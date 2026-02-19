import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    hostId: v.string(),
    sessionId: v.optional(v.id("sessions")),
    type: v.union(
      v.literal("authenticate"),
      v.literal("list_dirs"),
      v.literal("start_opencode"),
      v.literal("stop_opencode"),
      v.literal("relay_message"),
      v.literal("get_providers"),
      v.literal("refresh_jwt"),
      v.literal("get_history")
    ),
    payload: v.object({
      otp: v.optional(v.string()),
      sessionCode: v.optional(v.string()),
      path: v.optional(v.string()),
      directory: v.optional(v.string()),
      message: v.optional(v.string()),
      port: v.optional(v.number()),
      sessionId: v.optional(v.string()),
      providerID: v.optional(v.string()),
      modelID: v.optional(v.string()),
    }),
    jwt: v.optional(v.string()),
    clientId: v.string(),
  },
  handler: async (ctx, args) => {
    const requestId = await ctx.db.insert("requests", {
      hostId: args.hostId,
      sessionId: args.sessionId,
      type: args.type,
      payload: args.payload,
      jwt: args.jwt,
      status: "pending",
      createdAt: Date.now(),
      clientId: args.clientId,
    });
    return requestId;
  },
});

export const getPendingForHost = query({
  args: { hostId: v.string() },
  handler: async (ctx, { hostId }) => {
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_host_status", (q) =>
        q.eq("hostId", hostId).eq("status", "pending")
      )
      .take(50);
    return requests;
  },
});

export const getResponse = query({
  args: { clientId: v.string() },
  handler: async (ctx, { clientId }) => {
    // Get the most recent request for this client
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .order("desc")
      .take(1);
    return requests[0] || null;
  },
});

export const getLatestByType = query({
  args: {
    clientId: v.string(),
    type: v.string(),
  },
  handler: async (ctx, { clientId, type }) => {
    const requests = await ctx.db
      .query("requests")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .order("desc")
      .take(50);
    // Filter by type in-memory (Convex doesn't support compound index on clientId + type)
    return requests.find((r) => r.type === type) || null;
  },
});

export const markProcessing = mutation({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    await ctx.db.patch(requestId, { status: "processing" });
  },
});

export const markCompleted = mutation({
  args: {
    requestId: v.id("requests"),
    response: v.object({
      jwtToken: v.optional(v.string()),
      directories: v.optional(v.array(v.string())),
      port: v.optional(v.number()),
      pid: v.optional(v.number()),
      aiResponse: v.optional(v.string()),
      reasoning: v.optional(v.string()),
      providersJson: v.optional(v.string()),
      sessionsJson: v.optional(v.string()),
      historyJson: v.optional(v.string()),
      error: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { requestId, response }) => {
    await ctx.db.patch(requestId, {
      status: "completed",
      response,
      completedAt: Date.now(),
    });
  },
});

export const markFailed = mutation({
  args: {
    requestId: v.id("requests"),
    error: v.string(),
  },
  handler: async (ctx, { requestId, error }) => {
    await ctx.db.patch(requestId, {
      status: "failed",
      response: { error },
      completedAt: Date.now(),
    });
  },
});

export const updatePartialResponse = mutation({
  args: {
    requestId: v.id("requests"),
    text: v.optional(v.string()),
    reasoning: v.optional(v.string()),
  },
  handler: async (ctx, { requestId, text, reasoning }) => {
    const patch: { partialResponse?: string; partialReasoning?: string } = {};
    if (text !== undefined) patch.partialResponse = text;
    if (reasoning !== undefined) patch.partialReasoning = reasoning;
    if (Object.keys(patch).length === 0) return;
    await ctx.db.patch(requestId, patch);
  },
});

// Add a message part (reasoning, text, or tool) for separate bubble rendering
export const addMessagePart = mutation({
  args: {
    requestId: v.id("requests"),
    partType: v.union(v.literal("reasoning"), v.literal("text"), v.literal("tool")),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, { requestId, partType, content, metadata }) => {
    const request = await ctx.db.get(requestId);
    if (!request) return;

    const parts = request.parts || [];
    parts.push({
      type: partType,
      content,
      metadata,
      createdAt: Date.now(),
    });

    await ctx.db.patch(requestId, { parts });
  },
});

export const getStreamingResponse = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) return null;
    return {
      status: request.status,
      partialResponse: request.partialResponse || null,
      partialReasoning: request.partialReasoning || null,
      parts: request.parts || null,
      response: request.response || null,
    };
  },
});

// Set a pending tool invocation (called by Host when AI uses a tool)
export const setPendingTool = mutation({
  args: {
    requestId: v.id("requests"),
    toolName: v.string(),
    toolInput: v.any(),
    toolCallId: v.string(),
  },
  handler: async (ctx, { requestId, toolName, toolInput, toolCallId }) => {
    await ctx.db.patch(requestId, {
      pendingTool: {
        toolName,
        toolInput,
        toolCallId,
        createdAt: Date.now(),
      },
    });
  },
});

// Submit a tool result (called by Client after user answers)
export const submitToolResult = mutation({
  args: {
    requestId: v.id("requests"),
    toolCallId: v.string(),
    result: v.any(),
  },
  handler: async (ctx, { requestId, toolCallId, result }) => {
    await ctx.db.patch(requestId, {
      toolResult: {
        toolCallId,
        result,
        submittedAt: Date.now(),
      },
    });
  },
});

// Get tool status for a request
export const getToolStatus = query({
  args: { requestId: v.id("requests") },
  handler: async (ctx, { requestId }) => {
    const request = await ctx.db.get(requestId);
    if (!request) return null;
    return {
      pendingTool: request.pendingTool || null,
      toolResult: request.toolResult || null,
    };
  },
});

// Cleanup old completed/failed requests (older than 1 hour)
export const cleanup = mutation({
  args: {},
  handler: async (ctx) => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const oldRequests = await ctx.db
      .query("requests")
      .filter((q) =>
        q.and(
          q.or(
            q.eq(q.field("status"), "completed"),
            q.eq(q.field("status"), "failed")
          ),
          q.lt(q.field("createdAt"), oneHourAgo)
        )
      )
      .take(100);

    for (const req of oldRequests) {
      await ctx.db.delete(req._id);
    }
    return oldRequests.length;
  },
});
