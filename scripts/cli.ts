#!/usr/bin/env bun
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONVEX_URL = process.env.CONVEX_URL || "https://intent-chinchilla-833.convex.cloud";

const client = new ConvexClient(CONVEX_URL);

function showHelp() {
  console.log(`
Usage: bun run x <command> [options]

Commands:
  create                          Create a new session with unique code and OTP
  send     --code <code> --password <pwd> --message <msg>   Send a message to a session
  list     --code <code> --password <pwd>                    List all messages in a session
  validate --code <code> --password <pwd>                    Validate session credentials

Options:
  --code <code>       Session code (6 characters)
  --password <pwd>    Session OTP/password (10 characters)
  --message <msg>     Message text to send
  --help, -h          Show this help message

Examples:
  bun run x create
  bun run x send --code ABC123 --password xyz789abc --message "Hello world"
  bun run x list --code ABC123 --password xyz789abc
  bun run x validate --code ABC123 --password xyz789abc
`);
}

function parseArgs(args: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        result[key] = value;
        i++;
      } else {
        result[key] = "true";
      }
    }
  }
  return result;
}

async function createSession() {
  try {
    const result = await client.mutation(api.sessions.create, {});
    console.log("✅ Session created successfully!");
    console.log(`   Code:     ${result.code}`);
    console.log(`   Password: ${result.password}`);
    console.log(`   ID:       ${result.sessionId}`);
    console.log("\n   Save these credentials - you\'ll need them to access the session.");
  } catch (error) {
    console.error("❌ Failed to create session:", error);
    process.exit(1);
  }
}

async function validateSession(code: string, password: string) {
  try {
    const sessionId = await client.query(api.sessions.validate, { code, password });
    if (sessionId) {
      console.log("✅ Session is valid");
      console.log(`   Session ID: ${sessionId}`);
      return sessionId;
    } else {
      console.error("❌ Invalid code or password, or session expired");
      process.exit(1);
    }
  } catch (error) {
    console.error("❌ Failed to validate session:", error);
    process.exit(1);
  }
}

async function sendMessage(code: string, password: string, text: string) {
  try {
    const sessionId = await client.query(api.sessions.validate, { code, password });
    if (!sessionId) {
      console.error("❌ Invalid code or password, or session expired");
      process.exit(1);
    }
    
    await client.mutation(api.messages.send, {
      sessionId,
      sender: "cli-user",
      text
    });
    console.log("✅ Message sent successfully");
  } catch (error) {
    console.error("❌ Failed to send message:", error);
    process.exit(1);
  }
}

async function listMessages(code: string, password: string) {
  try {
    const sessionId = await client.query(api.sessions.validate, { code, password });
    if (!sessionId) {
      console.error("❌ Invalid code or password, or session expired");
      process.exit(1);
    }
    
    const messages = await client.query(api.messages.list, { sessionId });
    if (messages.length === 0) {
      console.log("No messages in this session yet.");
      return;
    }
    
    console.log(`\n📨 Messages (${messages.length} total):\n`);
    messages.forEach((msg, idx) => {
      const date = new Date(msg.timestamp);
      const timeStr = date.toLocaleTimeString();
      console.log(`  [${idx + 1}] ${timeStr} - ${msg.sender}:`);
      console.log(`       ${msg.text}\n`);
    });
  } catch (error) {
    console.error("❌ Failed to list messages:", error);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    showHelp();
    process.exit(0);
  }
  
  const command = args[0];
  const parsedArgs = parseArgs(args.slice(1));
  
  switch (command) {
    case "create":
      await createSession();
      break;
      
    case "validate":
      if (!parsedArgs.code || !parsedArgs.password) {
        console.error("❌ Error: --code and --password are required");
        console.error("   Usage: bun run x validate --code <code> --password <pwd>");
        process.exit(1);
      }
      await validateSession(parsedArgs.code, parsedArgs.password);
      break;
      
    case "send":
      if (!parsedArgs.code || !parsedArgs.password || !parsedArgs.message) {
        console.error("❌ Error: --code, --password, and --message are required");
        console.error("   Usage: bun run x send --code <code> --password <pwd> --message <msg>");
        process.exit(1);
      }
      await sendMessage(parsedArgs.code, parsedArgs.password, parsedArgs.message);
      break;
      
    case "list":
      if (!parsedArgs.code || !parsedArgs.password) {
        console.error("❌ Error: --code and --password are required");
        console.error("   Usage: bun run x list --code <code> --password <pwd>");
        process.exit(1);
      }
      await listMessages(parsedArgs.code, parsedArgs.password);
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.error("   Run 'bun run x --help' for usage information");
      process.exit(1);
  }
  
  process.exit(0);
}

main();
