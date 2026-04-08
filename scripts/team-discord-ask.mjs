#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OPENCLAW_INSTANCE = path.join(ROOT, "scripts", "openclaw-instance");
const DISCORD_AGENT_TIMEOUT = process.env.OPENCLAW_DISCORD_AGENT_TIMEOUT || "180";
const DISCORD_WALL_TIMEOUT = Number(process.env.OPENCLAW_DISCORD_WALL_TIMEOUT || 300000);

function usage() {
  console.error("usage: team-discord-ask.mjs <agent-id> <message...>");
}

function runAgent(instance, message) {
  const output = execFileSync(
    OPENCLAW_INSTANCE,
    [
      instance,
      "agent",
      "--local",
      "--agent",
      "main",
      "--message",
      message,
      "--thinking",
      process.env.OPENCLAW_DISCORD_THINKING || "off",
      "--timeout",
      DISCORD_AGENT_TIMEOUT,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: DISCORD_WALL_TIMEOUT,
      env: { ...process.env, OPENCLAW_INSTANCE_PROMPT_STYLE: "passthrough" },
    }
  );
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

const [agentId, ...messageParts] = process.argv.slice(2);
if (!agentId || messageParts.length === 0) {
  usage();
  process.exit(1);
}

const userMessage = messageParts.join(" ");
const prompt = `You are replying on Discord as yourself.

The shared discussion rules live in TEAM_DISCUSSION_CONTRACT.md.
The shared Discord meeting behavior lives in DISCORD_BOT_BEHAVIOR.md.

Human message:
${userMessage}

You were directly addressed, so you must reply even if the request is trivial.
Reply as yourself in the exact words you would post from your own Discord bot identity.
Keep it concise and useful.
Do not reply SILENT.`;

const reply = runAgent(agentId, prompt);
process.stdout.write(`${JSON.stringify({ agentId, prompt: userMessage, reply }, null, 2)}\n`);
