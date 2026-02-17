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
      v.literal("relay_message")
    ),
    payload: v.object({
      otpAttempt: v.optional(v.string()),
      sessionCode: v.optional(v.string()),
      path: v.optional(v.string()),
      directory: v.optional(v.string()),
      message: v.optional(v.string()),
      port: v.optional(v.number()),
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
    text: v.string(),
  },
  handler: async (ctx, { requestId, text }) => {
    await ctx.db.patch(requestId, {
      partialResponse: text,
    });
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
      response: request.response || null,
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
