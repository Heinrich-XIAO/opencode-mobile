import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function generateCode(length = 6): string {
  return Math.random().toString(36).replace(/[^a-z]+/g, '').slice(0, length).toUpperCase();
}

function generatePassword(length = 10): string {
  return [...Array(length)].map(() => Math.random().toString(36)[2]).join("");
}

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const code = generateCode();
    const password = generatePassword();
    const now = Date.now();
    const expiresAt = now + 4 * 60 * 60 * 1000; // 4 hours
    const sessionId = await ctx.db.insert("sessions", { 
      code, 
      password, 
      createdAt: now, 
      expiresAt 
    });
    return { code, password, sessionId };
  },
});

export const validate = query({
  args: { 
    code: v.string(), 
    password: v.string() 
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();
    if (!session || session.password !== args.password || Date.now() > session.expiresAt) {
      return null;
    }
    return session._id;
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query("sessions").order("desc").take(200);
    return sessions;
  },
});

export const remove = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    await ctx.db.delete("sessions", sessionId);
  },
});
