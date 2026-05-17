#!/usr/bin/env node
import { spawn } from "node:child_process";

const BASE_PORT = Number(process.env.SMOKE_PORT || "4010");
const STARTUP_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || "30000");
const POLL_INTERVAL_MS = 500;
const HEALTH_URL = `http://127.0.0.1:${BASE_PORT}/health`;

let server;
let startupBuffer = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth() {
  const response = await fetch(HEALTH_URL);
  if (!response.ok) {
    throw new Error(`Health check returned HTTP ${response.status}`);
  }
}

function startServer() {
  server = spawn("node", ["dist/src/index.js"], {
    env: {
      ...process.env,
      PORT: String(BASE_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => {
    startupBuffer += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    startupBuffer += chunk.toString();
  });
}

async function stopServer() {
  if (!server || server.killed) {
    return;
  }
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!server.killed) {
        server.kill("SIGKILL");
      }
      resolve();
    }, 4000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function run() {
  const startedAt = Date.now();
  startServer();

  let healthy = false;
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (server.exitCode !== null) {
      break;
    }
    try {
      await checkHealth();
      healthy = true;
      break;
    } catch {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  await stopServer();

  if (!healthy) {
    console.error("Runtime smoke gate FAILED.");
    console.error(`Target: ${HEALTH_URL}`);
    if (startupBuffer.trim()) {
      console.error("--- server output ---");
      console.error(startupBuffer.trim());
    }
    process.exit(1);
  }

  console.log(`Runtime smoke gate PASSED (${HEALTH_URL})`);
}

run().catch(async (error) => {
  await stopServer();
  console.error("Runtime smoke gate FAILED with error:");
  console.error(error instanceof Error ? error.message : String(error));
  if (startupBuffer.trim()) {
    console.error("--- server output ---");
    console.error(startupBuffer.trim());
  }
  process.exit(1);
});
