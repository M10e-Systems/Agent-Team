#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import fs from "node:fs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const INDEX_FILE = path.join(ROOT, "runtime", "team-index.json");
const OPENCLAW_INSTANCE = path.join(ROOT, "scripts", "openclaw-instance");
const ROOM_AGENT_TIMEOUT = process.env.OPENCLAW_ROOM_AGENT_TIMEOUT || "300";
const ROOM_WALL_TIMEOUT = Number(process.env.OPENCLAW_ROOM_WALL_TIMEOUT || 600000);

function usage() {
  console.error("usage: team-room-json.mjs <team-id> <prompt...>");
}

function loadIndex() {
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8"));
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
      ROOM_AGENT_TIMEOUT,
    ],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: ROOM_WALL_TIMEOUT,
      env: { ...process.env, OPENCLAW_INSTANCE_PROMPT_STYLE: "passthrough" },
    }
  );
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.at(-1) ?? "";
}

function buildTurn(agentId, text) {
  return { agentId, text };
}

const [teamId, ...promptParts] = process.argv.slice(2);
if (!teamId || promptParts.length === 0) {
  usage();
  process.exit(1);
}

const prompt = promptParts.join(" ");
const index = loadIndex();
const team = index.teams?.[teamId];
if (!team) {
  console.error(`unknown team: ${teamId}`);
  process.exit(1);
}

const facilitator = team.facilitatorId;
const specialists = team.agentIds.filter((agentId) => agentId !== facilitator);
const turns = [];
const forceAll = process.env.OPENCLAW_FORCE_ALL_RESPONSES === "1";
const forcedAgents = new Set(
  String(process.env.OPENCLAW_FORCE_AGENT_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);

function isForced(agentId) {
  return forceAll || forcedAgents.has(agentId);
}

let transcript = `USER: ${prompt}`;

const facilitatorPrompt = `You are in the ${teamId} discussion room on Discord.

The shared discussion rules live in TEAM_DISCUSSION_CONTRACT.md.
The shared Discord meeting behavior lives in DISCORD_BOT_BEHAVIOR.md.

User prompt:
${prompt}

${isForced(facilitator) ? "You were directly tagged for this round and must reply with one concise message. Do not reply SILENT.\n" : ""}
Respond as yourself, in the exact words you would post from your own Discord bot identity.
Keep it concise and useful.
If you do not need to speak yet, reply exactly SILENT.`;

const facilitatorReply = runAgent(facilitator, facilitatorPrompt);
if (facilitatorReply !== "SILENT") {
  turns.push(buildTurn(facilitator, facilitatorReply));
  transcript += `\n${facilitator}: ${facilitatorReply}`;
} else if (!isForced(facilitator)) {
  process.stdout.write(`${JSON.stringify({ teamId, prompt, turns }, null, 2)}\n`);
  process.exit(0);
}

for (const specialist of specialists) {
  const specialistPrompt = `You are in the ${teamId} discussion room on Discord.

The shared discussion rules live in TEAM_DISCUSSION_CONTRACT.md.
The shared Discord meeting behavior lives in DISCORD_BOT_BEHAVIOR.md.

Current transcript:
${transcript}

${isForced(specialist)
    ? "You were directly tagged for this round and must reply with one concise message. Do not reply SILENT."
    : "Speak only if your lens gives you one concrete contribution that is not already covered."}
If you speak, reply with only the exact words you would post from your own Discord bot identity.
If not, reply exactly SILENT.`;
  const specialistReply = runAgent(specialist, specialistPrompt);
  if (specialistReply !== "SILENT") {
    turns.push(buildTurn(specialist, specialistReply));
    transcript += `\n${specialist}: ${specialistReply}`;
  }
}

const synthesisPrompt = `You are the facilitator for the ${teamId} room on Discord.

The shared discussion rules live in TEAM_DISCUSSION_CONTRACT.md.
The shared Discord meeting behavior lives in DISCORD_BOT_BEHAVIOR.md.

Current transcript:
${transcript}

If the room needs a short synthesis or next step, give one brief closing message as yourself.
If not, reply exactly SILENT.`;

const synthesisReply = runAgent(facilitator, synthesisPrompt);
if (synthesisReply !== "SILENT") {
  turns.push(buildTurn(facilitator, synthesisReply));
}

process.stdout.write(`${JSON.stringify({ teamId, prompt, turns }, null, 2)}\n`);
