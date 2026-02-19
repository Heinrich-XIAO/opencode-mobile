#!/usr/bin/env bun

import { spawn } from "child_process";

const defaultDeployment = "prod:utmost-wren-887";
const deployment = process.env.CONVEX_DEPLOYMENT || defaultDeployment;

if (!process.env.CONVEX_DEPLOY_KEY) {
  console.error("[vercel-build] Missing CONVEX_DEPLOY_KEY.");
  console.error("[vercel-build] Add CONVEX_DEPLOY_KEY in Vercel project environment variables.");
  process.exit(1);
}

const child = spawn(
  "bunx",
  ["convex", "deploy", "--prod", "--cmd", "bunx expo export:web"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CONVEX_DEPLOYMENT: deployment,
    },
  }
);

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
