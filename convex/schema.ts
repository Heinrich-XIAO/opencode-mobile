import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  sessions: defineTable({
    code: v.string(),
    password: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  }).index("by_code", ["code"]),

  messages: defineTable({
    sessionId: v.id("sessions"),
    sender: v.string(),
    text: v.string(),
    timestamp: v.number(),
  })
  .index("by_session_timestamp", ["sessionId", "timestamp"]),
});