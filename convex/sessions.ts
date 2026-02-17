import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function randomCode(length: number, alphabet: string): string {
  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PASSWORD_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const code = randomCode(6, CODE_ALPHABET);
    const password = randomCode(10, PASSWORD_ALPHABET);
    const now = Date.now();
    const expiresAt = now + 10 * 60 * 1000;

    const sessionId = await ctx.db.insert("sessions", {
      code,
      password,
      createdAt: now,
      expiresAt,
    });

    return { sessionId, code, password, expiresAt };
  },
});

export const validate = query({
  args: { code: v.string(), password: v.string() },
  handler: async (ctx, { code, password }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();

    if (!session) return null;
    if (session.password !== password) return null;
    if (session.expiresAt < Date.now()) return null;

    return session._id;
  },
});
