import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const send = mutation({
  args: { 
    sessionId: v.id("sessions"),
    sender: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("messages", { 
      ...args,
      timestamp: Date.now()
    });
  },
});

export const list = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const messagesQuery = ctx.db
      .query("messages")
      .withIndex("by_session_timestamp", (q) => q.eq("sessionId", sessionId))
      .order("asc")
      .take(200);
    const messages = await messagesQuery;
    return messages;
  },
});
