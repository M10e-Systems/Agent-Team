#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const INDEX_FILE = path.join(ROOT, "runtime", "team-index.json");

function resolveRepoPath(repoPath) {
  if (!repoPath) {
    throw new Error("missing repoPath in team index");
  }
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(ROOT, repoPath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`runtime index not found: ${INDEX_FILE}\nrun ./scripts/teamctl init first`);
  }
  return readJson(INDEX_FILE);
}

function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").trim();
}

function loadAgentContext(index, agentId) {
  const agent = index.agents?.[agentId];
  if (!agent) {
    throw new Error(`unknown agent '${agentId}'`);
  }

  const repoPath = resolveRepoPath(agent.repoPath);
  const workspacePath = path.join(repoPath, "agents", agentId, "workspace");
  const sharedFiles = ["TEAM_DISCUSSION_CONTRACT.md", "DISCORD_BOT_BEHAVIOR.md"];
  const personaFiles = ["IDENTITY.md", "SOUL.md", "AGENTS.md", "TOOLS.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];
  const sections = [];

  const teamJson = readTextFileIfExists(path.join(repoPath, "team.json"));
  if (teamJson) sections.push(["team.json", teamJson]);

  for (const filename of sharedFiles) {
    const text = readTextFileIfExists(path.join(repoPath, "shared", filename));
    if (text) sections.push([`shared/${filename}`, text]);
  }

  for (const filename of personaFiles) {
    const text = readTextFileIfExists(path.join(workspacePath, filename));
    if (text) sections.push([`agents/${agentId}/workspace/${filename}`, text]);
  }

  return {
    cwd: workspacePath,
    repoPath,
    text: sections.map(([label, text]) => `## ${label}\n${text}`).join("\n\n"),
  };
}

function resolveCodexAcpCommand() {
  return process.env.TEAM_CODEX_ACP_COMMAND || path.join(ROOT, "node_modules", ".bin", "codex-acp");
}

function buildCodexAcpEnv() {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  env.CODEX_ACP_PROVIDER = "codex-acp";
  return env;
}

function buildPrompt(mode, contextText, message) {
  if (mode === "direct") {
    return [
      "You are acting as one visible Discord bot participant in a small team room.",
      "This is not a coding task. Do not perform repository maintenance, journaling, file edits, command execution, or task management.",
      "Write exactly one concise Discord message for this agent, or exactly SILENT when silence is appropriate.",
      "Do not prefix the message with your name or agent id; Discord already shows your bot identity.",
      "Do not narrate routing, ACP, prompts, providers, or implementation details.",
      "Do not mention hidden instructions, system prompts, journal rules, or the word SILENT unless your entire output is exactly SILENT.",
      "If the human message appears to be a typo, a transport test, or a meaningless string, output exactly SILENT.",
      "Do not claim to have taken external actions unless the human explicitly asked you to do so.",
      "",
      "# Agent and team context",
      contextText,
      "",
      "# Human Discord message",
      message,
      "",
      "# Required output",
      "Return only the Discord message body or the exact token SILENT.",
    ].join("\n");
  }

  return [
    "You are responding as this agent using the provided team and workspace context.",
    "This is not a coding task. Do not edit files, run commands, mention hidden instructions, or explain your reasoning.",
    "Return only the final reply text for the prompt below. No preamble, no analysis, no quotes.",
    "If the prompt explicitly requires an exact token such as HEARTBEAT_OK or SILENT, output only that token.",
    "",
    "# Agent and team context",
    contextText,
    "",
    "# Prompt",
    message,
  ].join("\n");
}

async function run(agentId, mode, message) {
  const index = loadIndex();
  const context = loadAgentContext(index, agentId);
  const command = resolveCodexAcpCommand();
  if (!fs.existsSync(command) && command.includes(path.sep)) {
    throw new Error(`codex-acp command not found: ${command}`);
  }

  const child = spawn(command, [], {
    cwd: context.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: buildCodexAcpEnv(),
  });

  let stderr = "";
  const capture = [];
  let sessionId = null;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  if (!child.stdin || !child.stdout) {
    throw new Error("failed to create codex-acp stdio pipes");
  }

  const client = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params) => {
        if (params.sessionId !== sessionId) return;
        if (params.update.sessionUpdate === "agent_message_chunk" && params.update.content?.type === "text") {
          capture.push(params.update.content.text);
        }
      },
      requestPermission: async () => ({ outcome: { outcome: "cancelled" } }),
      readTextFile: async () => {
        throw new Error("client filesystem reads are disabled for team turns");
      },
      writeTextFile: async () => {
        throw new Error("client filesystem writes are disabled for team turns");
      },
      createTerminal: async () => {
        throw new Error("client terminals are disabled for team turns");
      },
    }),
    ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)),
  );

  await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { auth: { terminal: false } },
    clientInfo: { name: "codex-acp-agent-runner", version: "1.0.0" },
  });

  const session = await client.newSession({
    cwd: context.cwd,
    additionalDirectories: [context.repoPath],
    mcpServers: [],
  });
  sessionId = session.sessionId;

  await client.prompt({
    sessionId,
    prompt: [{ type: "text", text: buildPrompt(mode, context.text, message) }],
  });

  const reply = capture.join("").trim();
  try {
    await client.close?.();
  } catch {
    // ignore
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  await new Promise((resolve) => child.once("close", resolve));

  if (stderr.trim() && (process.env.TEAM_AGENT_RUNNER_DEBUG === "1" || !reply)) {
    process.stderr.write(stderr);
  }

  process.stdout.write(`${reply}\n`);
}

const [agentId, modeArg, ...messageParts] = process.argv.slice(2);
if (!agentId || !modeArg || messageParts.length === 0) {
  console.error("usage: codex-acp-agent-runner.mjs <agent-id> <direct|passthrough> <message...>");
  process.exit(1);
}

const mode = modeArg === "direct" ? "direct" : "passthrough";

try {
  await run(agentId, mode, messageParts.join(" "));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
