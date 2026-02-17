import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    code: v.string(),
    password: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    hostId: v.optional(v.string()),
  }).index("by_code", ["code"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    sender: v.string(),
    text: v.string(),
    timestamp: v.number(),
  }).index("by_session_timestamp", ["sessionId", "timestamp"]),

  requests: defineTable({
    // Targeting
    hostId: v.string(),
    sessionId: v.optional(v.id("sessions")),

    // Request details
    type: v.union(
      v.literal("authenticate"),
      v.literal("list_dirs"),
      v.literal("start_opencode"),
      v.literal("stop_opencode"),
      v.literal("relay_message"),
      v.literal("get_providers"),
      v.literal("refresh_jwt")
    ),
    payload: v.object({
      // For authenticate:
      otpAttempt: v.optional(v.string()),
      sessionCode: v.optional(v.string()),

      // For list_dirs:
      path: v.optional(v.string()),

      // For start_opencode / stop_opencode:
      directory: v.optional(v.string()),

      // For relay_message:
      message: v.optional(v.string()),
      port: v.optional(v.number()),

      // For relay_message (model selection):
      providerID: v.optional(v.string()),
      modelID: v.optional(v.string()),
    }),

    // Authentication
    jwt: v.optional(v.string()),

    // Status tracking
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed")
    ),

    // Response data
    response: v.optional(
      v.object({
        // For authenticate:
        jwtToken: v.optional(v.string()),

        // For list_dirs:
        directories: v.optional(v.array(v.string())),

        // For start_opencode:
        port: v.optional(v.number()),
        pid: v.optional(v.number()),

        // For relay_message:
        aiResponse: v.optional(v.string()),

        // For get_providers: JSON string of providers data
        providersJson: v.optional(v.string()),

        // For all failed:
        error: v.optional(v.string()),
      })
    ),

    // Streaming: partial AI response text updated incrementally
    partialResponse: v.optional(v.string()),

    // Metadata
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    clientId: v.string(),
  })
    .index("by_host_status", ["hostId", "status"])
    .index("by_session", ["sessionId"])
    .index("by_client", ["clientId"]),

  hosts: defineTable({
    hostId: v.string(),
    status: v.union(v.literal("online"), v.literal("offline")),

    // Active processes
    activeDirectories: v.array(
      v.object({
        path: v.string(),
        port: v.number(),
        pid: v.number(),
        startedAt: v.number(),
        lastActivity: v.number(),
      })
    ),

    // Capabilities
    version: v.string(),
    platform: v.string(),

    // Heartbeat
    lastSeen: v.number(),
  })
    .index("by_hostId", ["hostId"])
    .index("by_status", ["status"]),
});
