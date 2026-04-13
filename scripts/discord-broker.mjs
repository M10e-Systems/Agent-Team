#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const INDEX_FILE = path.join(ROOT, "runtime", "team-index.json");
const ENV_FILES = [
  path.join(ROOT, ".env"),
];
const PID_FILE = path.join(ROOT, "runtime", "discord-broker.pid");
const TEAM_OPERATOR_DISCORD_RELATIVE_PATH = path.join("operator", "discord.json");

function resolveRepoPath(repoPath) {
  if (!repoPath) {
    throw new Error("missing repoPath in team index");
  }
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(ROOT, repoPath);
}

function usage() {
  console.error("usage:");
  console.error("  node scripts/discord-broker.mjs validate [routes-file]");
  console.error("  node scripts/discord-broker.mjs run [routes-file]");
  console.error("  node scripts/discord-broker.mjs inject <routes-file> <channel-id|team-id> <message...>");
  console.error("  node scripts/discord-broker.mjs provider-doctor [routes-file]");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDotEnv() {
  for (const envFile of ENV_FILES) {
    if (!fs.existsSync(envFile)) continue;
    const lines = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const idx = line.indexOf("=");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1);
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function mergeDiscordConfig(baseConfig, index) {
  const baseDiscord = baseConfig?.discord || {};
  const merged = {
    discord: {
      responsePolicy: { ...(baseDiscord.responsePolicy || {}) },
      bots: Array.isArray(baseDiscord.bots) ? [...baseDiscord.bots] : [],
      channels: Array.isArray(baseDiscord.channels) ? [...baseDiscord.channels] : [],
      aliases: { ...(baseDiscord.aliases || {}) },
    },
  };

  if (baseDiscord.guildId) {
    merged.discord.guildId = baseDiscord.guildId;
  }

  for (const [teamId, teamEntry] of Object.entries(index.teams || {})) {
    const repoPath = resolveRepoPath(teamEntry.repoPath);
    const operatorDiscordPath = path.join(repoPath, TEAM_OPERATOR_DISCORD_RELATIVE_PATH);
    if (!fs.existsSync(operatorDiscordPath)) {
      throw new Error(`missing team operator Discord config for '${teamId}': ${operatorDiscordPath}`);
    }

    const operatorConfig = readJson(operatorDiscordPath);
    const teamDiscord = operatorConfig?.discord || {};
    const teamGuildId =
      typeof teamDiscord.guildId === "string" && teamDiscord.guildId.trim().length > 0
        ? teamDiscord.guildId
        : null;

    for (const bot of teamDiscord.bots || []) {
      merged.discord.bots.push(bot);
    }

    for (const channel of teamDiscord.channels || []) {
      merged.discord.channels.push({
        ...channel,
        teamId: channel.teamId || teamId,
        guildId: channel.guildId || teamGuildId || undefined,
      });
    }

    if (teamDiscord.aliases && typeof teamDiscord.aliases === "object") {
      merged.discord.aliases[teamId] = {
        ...(merged.discord.aliases[teamId] || {}),
        ...teamDiscord.aliases,
      };
    }
  }

  return merged;
}

function loadRoutes(routesFileArg, index) {
  const routesFile = path.resolve(routesFileArg || path.join(ROOT, "discord.routes.json"));
  if (!fs.existsSync(routesFile)) {
    throw new Error(`routes file not found: ${routesFile}\nrestore discord.routes.json from source control`);
  }
  return { routesFile, config: mergeDiscordConfig(readJson(routesFile), index) };
}

function loadIndex() {
  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error(`runtime index not found: ${INDEX_FILE}\nrun ./scripts/teamctl init first`);
  }
  return readJson(INDEX_FILE);
}

function ensureSingleBrokerInstance() {
  try {
    if (fs.existsSync(PID_FILE)) {
      const existingPid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
      if (existingPid && existingPid !== process.pid) {
        try {
          process.kill(existingPid, 0);
          throw new Error(`another discord broker is already running with pid ${existingPid}`);
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
            throw error;
          }
        }
      }
    }

    fs.mkdirSync(path.dirname(PID_FILE), { recursive: true });
    fs.writeFileSync(PID_FILE, `${process.pid}\n`);

    const cleanup = () => {
      try {
        if (fs.existsSync(PID_FILE)) {
          const currentPid = Number(fs.readFileSync(PID_FILE, "utf8").trim());
          if (currentPid === process.pid) {
            fs.rmSync(PID_FILE, { force: true });
          }
        }
      } catch {
        // ignore
      }
    };

    process.on("exit", cleanup);
    process.on("SIGINT", () => {
      cleanup();
      process.exit(130);
    });
    process.on("SIGTERM", () => {
      cleanup();
      process.exit(143);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`broker startup refused: ${message}`);
  }
}

function normalizeText(value) {
  return String(value || "").toLowerCase();
}

function logBrokerError(context, error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
  console.error(`[discord-broker] ${context}: ${message}`.trim());
}

function validateConfig(config, index) {
  const errors = [];
  const discord = config.discord;
  if (!discord || typeof discord !== "object") {
    errors.push("missing top-level discord object");
    return errors;
  }
  const hasTopLevelGuildId = typeof discord.guildId === "string" && discord.guildId.trim().length > 0;
  if (discord.guildId !== undefined && typeof discord.guildId !== "string") {
    errors.push("discord.guildId must be a string when provided");
  }
  if (!Array.isArray(discord.bots) || discord.bots.length === 0) {
    errors.push("discord.bots must be a non-empty array");
  } else {
    const seenAgents = new Set();
    for (const [idx, entry] of discord.bots.entries()) {
      if (!entry.agentId || !index.agents?.[entry.agentId]) {
        errors.push(`discord.bots[${idx}].agentId must reference a known agent`);
      } else if (seenAgents.has(entry.agentId)) {
        errors.push(`discord.bots[${idx}].agentId is duplicated`);
      } else {
        seenAgents.add(entry.agentId);
      }
      if (!entry.tokenEnvVar || typeof entry.tokenEnvVar !== "string") {
        errors.push(`discord.bots[${idx}].tokenEnvVar must be a string`);
      }
    }
  }
  if (!Array.isArray(discord.channels) || discord.channels.length === 0) {
    errors.push("discord.channels must be a non-empty array");
  } else {
    for (const [idx, entry] of discord.channels.entries()) {
      const hasRouteGuildId = typeof entry.guildId === "string" && entry.guildId.trim().length > 0;
      if (!entry.channelId || typeof entry.channelId !== "string") {
        errors.push(`discord.channels[${idx}].channelId must be a string`);
      }
      if (entry.guildId !== undefined && typeof entry.guildId !== "string") {
        errors.push(`discord.channels[${idx}].guildId must be a string when provided`);
      }
      if (!hasTopLevelGuildId && !hasRouteGuildId) {
        errors.push(`discord.channels[${idx}] must define guildId when top-level discord.guildId is omitted`);
      }
      if (!entry.teamId || !index.teams?.[entry.teamId]) {
        errors.push(`discord.channels[${idx}].teamId must reference a known team`);
      }
      if (entry.ingressAgentId && !index.agents?.[entry.ingressAgentId]) {
        errors.push(`discord.channels[${idx}].ingressAgentId must reference a known agent`);
      }
      if (entry.mode && !["meeting-room"].includes(entry.mode)) {
        errors.push(`discord.channels[${idx}].mode must currently be 'meeting-room' if provided`);
      }
    }
  }
  const aliases = discord.aliases || {};
  for (const [teamId, teamAliases] of Object.entries(aliases)) {
    if (!index.teams?.[teamId]) {
      errors.push(`discord.aliases.${teamId} references an unknown team`);
      continue;
    }
    for (const [alias, agentId] of Object.entries(teamAliases || {})) {
      if (!alias.startsWith("@")) {
        errors.push(`alias '${alias}' for team '${teamId}' must start with @`);
      }
      if (!index.agents?.[agentId]) {
        errors.push(`alias '${alias}' for team '${teamId}' references unknown agent '${agentId}'`);
      }
    }
  }
  return errors;
}

function resolveRouteGuildId(config, route) {
  if (route?.guildId) return route.guildId;
  if (config?.discord?.guildId) return config.discord.guildId;
  return null;
}

function resolveTeamChannel(config, guildId, channelId) {
  return (
    (config.discord.channels || []).find((entry) => {
      if (entry.channelId !== channelId) return false;
      const routeGuildId = resolveRouteGuildId(config, entry);
      return !routeGuildId || routeGuildId === guildId;
    }) || null
  );
}

function resolveRouteForInject(config, index, target) {
  const byChannel = (config.discord.channels || []).find((entry) => entry.channelId === target) || null;
  if (byChannel) return byChannel;
  if (index.teams?.[target]) {
    return (config.discord.channels || []).find((entry) => entry.teamId === target) || null;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAgentDiscordEnv(config) {
  const policy = config.discord.responsePolicy || {};
  return {
    ...process.env,
    TEAM_AGENT_THINKING: String(
      policy.agentThinking || process.env.TEAM_AGENT_THINKING || "off",
    ),
    TEAM_AGENT_TIMEOUT: String(
      policy.agentTimeoutSec || process.env.TEAM_AGENT_TIMEOUT || "45",
    ),
    TEAM_AGENT_WALL_TIMEOUT: String(
      policy.agentWallTimeout || process.env.TEAM_AGENT_WALL_TIMEOUT || "90s",
    ),
  };
}

function resolveAgentProvider(config = globalThis.__discordBrokerConfig) {
  const provider = String(
    process.env.TEAM_AGENT_PROVIDER ||
      config?.discord?.responsePolicy?.agentProvider ||
      "codex-acp",
  ).trim();
  if (!["openclaw", "codex-acp"].includes(provider)) {
    throw new Error(`unsupported TEAM_AGENT_PROVIDER '${provider}' (expected openclaw or codex-acp)`);
  }
  return provider;
}

function resolveProcessingTimeoutMs(config, fallbackMs) {
  const value = process.env.TEAM_AGENT_TIMEOUT_MS ?? config.discord.responsePolicy?.processingTimeoutMs ?? fallbackMs;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallbackMs;
}

function readTextFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, "utf8").trim();
}

function loadAgentPromptParts(index, agentId) {
  const agent = index.agents?.[agentId];
  if (!agent) {
    throw new Error(`unknown agent '${agentId}'`);
  }

  const repoPath = resolveRepoPath(agent.repoPath);
  const workspacePath = path.join(repoPath, "agents", agentId, "workspace");
  const teamJson = readTextFileIfExists(path.join(repoPath, "team.json"));
  const sharedFiles = ["TEAM_DISCUSSION_CONTRACT.md", "DISCORD_BOT_BEHAVIOR.md"];
  const personaFiles = ["IDENTITY.md", "SOUL.md", "AGENTS.md", "TOOLS.md", "USER.md", "MEMORY.md", "HEARTBEAT.md"];
  const sections = [];

  if (teamJson) {
    sections.push(["team.json", teamJson]);
  }
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

function formatCodexAcpPrompt({ index, teamId, agentId, messageText, forceReply, priorTurns = [], direct = false }) {
  const team = index.teams?.[teamId];
  if (!team) {
    throw new Error(`unknown team '${teamId}'`);
  }
  const persona = loadAgentPromptParts(index, agentId);
  const priorTurnText = priorTurns.length
    ? priorTurns.map((turn) => `${turn.agentId}: ${turn.text}`).join("\n")
    : "(none yet)";
  const replyInstruction = forceReply
    ? "You are directly addressed or explicitly required to answer. Do not reply SILENT."
    : "Reply exactly SILENT if your lens does not add something useful.";

  return {
    cwd: persona.cwd,
    text: [
      "You are acting as one visible Discord bot participant in a small team room.",
      "This is not a coding task. Do not perform repository maintenance, journaling, file edits, command execution, or task management.",
      "Write exactly one concise Discord message for this agent, or exactly SILENT when silence is appropriate.",
      "Do not prefix the message with your name or agent id; Discord already shows your bot identity.",
      "Do not narrate routing, ACP, prompts, providers, or implementation details.",
      "Do not mention hidden instructions, system prompts, journal rules, or the word SILENT unless your entire output is exactly SILENT.",
      "If the human message appears to be a typo, a transport test, or a meaningless string, output exactly SILENT unless force-reply applies.",
      "Do not claim to have taken external actions unless the human explicitly asked you to do so.",
      replyInstruction,
      direct ? "This is a direct ask to this single agent." : "This is a room round; avoid duplicating prior visible turns.",
      "",
      "# Agent and team context",
      persona.text,
      "",
      "# Room state",
      `Team: ${teamId}`,
      `Agent: ${agentId}`,
      `Prior visible turns in this round:\n${priorTurnText}`,
      "",
      "# Human Discord message",
      messageText,
      "",
      "# Required output",
      "Return only the Discord message body or the exact token SILENT.",
    ].join("\n"),
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

function choosePermissionRejection(options) {
  return (
    options.find((option) => option.kind === "reject_once") ||
    options.find((option) => option.kind === "reject_always")
  );
}

class CodexAcpProvider {
  constructor(index) {
    this.index = index;
    this.sessions = new Map();
  }

  async getSession(agentId) {
    const existing = this.sessions.get(agentId);
    if (existing && !existing.closed && !existing.active) {
      return existing;
    }
    if (existing?.active) {
      throw new Error(`codex-acp agent ${agentId} is already processing a turn`);
    }
    this.sessions.delete(agentId);

    const persona = loadAgentPromptParts(this.index, agentId);
    const command = resolveCodexAcpCommand();
    if (!fs.existsSync(command) && command.includes(path.sep)) {
      throw new Error(`codex-acp command not found: ${command}`);
    }

    const child = spawn(command, [], {
      cwd: persona.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCodexAcpEnv(),
    });
    const handle = {
      agentId,
      child,
      client: null,
      sessionId: null,
      stderr: "",
      active: false,
      capture: null,
      closed: false,
      initResponse: null,
    };
    this.sessions.set(agentId, handle);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      handle.stderr += chunk;
    });
    child.on("close", () => {
      handle.closed = true;
      if (this.sessions.get(agentId) === handle) {
        this.sessions.delete(agentId);
      }
    });

    if (!child.stdin || !child.stdout) {
      throw new Error("failed to create codex-acp stdio pipes");
    }

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout);
    const stream = ndJsonStream(input, output);
    handle.client = new ClientSideConnection(
      () => ({
        sessionUpdate: async (params) => {
          if (params.sessionId !== handle.sessionId || !handle.capture) return;
          const update = params.update;
          if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
            handle.capture.push(update.content.text);
          }
        },
        requestPermission: async (params) => {
          const rejection = choosePermissionRejection(params.options || []);
          if (rejection) {
            return { outcome: { outcome: "selected", optionId: rejection.optionId } };
          }
          return { outcome: { outcome: "cancelled" } };
        },
        readTextFile: async () => {
          throw new Error("client filesystem reads are disabled for Discord codex-acp turns");
        },
        writeTextFile: async () => {
          throw new Error("client filesystem writes are disabled for Discord codex-acp turns");
        },
        createTerminal: async () => {
          throw new Error("client terminals are disabled for Discord codex-acp turns");
        },
      }),
      stream,
    );

    handle.initResponse = await handle.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        auth: { terminal: false },
      },
      clientInfo: { name: "agent-team-tools-discord", version: "1.0.0" },
    });

    const session = await handle.client.newSession({
      cwd: persona.cwd,
      additionalDirectories: [persona.repoPath],
      mcpServers: [],
    });
    handle.sessionId = session.sessionId;

    const model = process.env.TEAM_CODEX_ACP_MODEL?.trim();
    if (model && typeof handle.client.unstable_setSessionModel === "function") {
      try {
        await handle.client.unstable_setSessionModel({ sessionId: handle.sessionId, modelId: model });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`codex-acp model override ignored for ${agentId}: ${message}`);
      }
    }

    return handle;
  }

  async runTurn({ teamId, agentId, messageText, forceReply, priorTurns = [], direct = false, timeoutMs }) {
    const handle = await this.getSession(agentId);
    const prompt = formatCodexAcpPrompt({
      index: this.index,
      teamId,
      agentId,
      messageText,
      forceReply,
      priorTurns,
      direct,
    });

    handle.active = true;
    handle.capture = [];
    let timeoutId = null;
    let timedOut = false;
    const promptPromise = handle.client.prompt({
      sessionId: handle.sessionId,
      prompt: [{ type: "text", text: prompt.text }],
    });
    try {
      await Promise.race([
        promptPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            void handle.client.cancel({ sessionId: handle.sessionId }).catch(() => {});
            try {
              handle.child.kill("SIGTERM");
            } catch {
              // ignore
            }
            setTimeout(() => {
              try {
                if (!handle.closed) handle.child.kill("SIGKILL");
              } catch {
                // ignore
              }
            }, 1500);
            reject(new Error(`codex-acp turn for ${agentId} exceeded ${timeoutMs}ms`));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (timedOut) throw error;
      const stderr = handle.stderr.trim();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(stderr ? `${message}\n${stderr}` : message);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      promptPromise.catch(() => {});
      handle.active = false;
    }

    const text = handle.capture.join("").trim();
    handle.capture = null;
    return text;
  }

  async close() {
    for (const handle of this.sessions.values()) {
      try {
        handle.child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }
}

let codexAcpProvider = null;

function getCodexAcpProvider(index) {
  if (!codexAcpProvider) {
    codexAcpProvider = new CodexAcpProvider(index);
    const closeProvider = () => {
      void codexAcpProvider?.close();
    };
    process.once("exit", closeProvider);
    process.once("SIGINT", () => {
      closeProvider();
      process.exit(130);
    });
    process.once("SIGTERM", () => {
      closeProvider();
      process.exit(143);
    });
  }
  return codexAcpProvider;
}

async function closeCodexAcpProviderIfStarted() {
  if (!codexAcpProvider) return;
  const provider = codexAcpProvider;
  codexAcpProvider = null;
  await provider.close();
}

function normalizeVisibleReply(reply, { forceReply = false } = {}) {
  const text = String(reply || "").trim();
  const unquoted = text.replace(/^[`"'\s]+|[`"'\s]+$/g, "").trim();
  if (!text || /^SILENT[.!]*$/i.test(unquoted)) return null;
  if (!forceReply && /\bSILENT\b/i.test(text) && /\b(prompt|routing|provider|journal|instruction|single message)\b/i.test(text)) {
    return null;
  }
  return text;
}

async function runCodexAcpDirect(index, teamId, agentId, messageText, processingTimeoutMs) {
  const reply = await getCodexAcpProvider(index).runTurn({
    teamId,
    agentId,
    messageText,
    forceReply: true,
    direct: true,
    timeoutMs: processingTimeoutMs,
  });
  return { reply: normalizeVisibleReply(reply, { forceReply: true }) ?? "SILENT" };
}

async function runCodexAcpRoom(index, teamId, prompt, forcedAgentIds, perTurnDelayMs, processingTimeoutMs, onTurn) {
  const team = index.teams?.[teamId];
  if (!team) {
    throw new Error(`unknown team '${teamId}'`);
  }
  const forced = new Set(forcedAgentIds || []);
  const allForced = forced.size === team.agentIds.length;
  const priorTurns = [];
  let turnsSent = 0;

  for (const agentId of team.agentIds) {
    const forceReply = forced.has(agentId) || allForced;
    const reply = normalizeVisibleReply(
      await getCodexAcpProvider(index).runTurn({
        teamId,
        agentId,
        messageText: prompt,
        forceReply,
        priorTurns,
        direct: false,
        timeoutMs: processingTimeoutMs,
      }),
      { forceReply },
    );
    if (!reply) continue;
    const turn = { agentId, text: reply };
    priorTurns.push(turn);
    turnsSent += 1;
    if (onTurn) {
      await onTurn(turn);
    }
    if (perTurnDelayMs > 0) {
      await sleep(perTurnDelayMs);
    }
  }

  return { turnsSent, turns: priorTurns };
}

function runJsonScript(scriptName, args, timeoutMs) {
  const stdout = execFileSync(path.join(ROOT, "scripts", scriptName), args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    env: buildAgentDiscordEnv(globalThis.__discordBrokerConfig),
  });
  return JSON.parse(stdout);
}

function parseTurnLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const idx = trimmed.indexOf(":");
  if (idx <= 0) return null;
  const agentId = trimmed.slice(0, idx).trim();
  const text = trimmed.slice(idx + 1).trim();
  if (!agentId || !text) return null;
  return { agentId, text };
}

async function runStreamingRoom(clientsByAgentId, channelId, teamId, prompt, perTurnDelayMs, processingTimeoutMs, extraEnv = {}) {
  const scriptPath = path.join(ROOT, "scripts", "team-room");
  const child = spawn(scriptPath, [teamId, prompt], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...buildAgentDiscordEnv(globalThis.__discordBrokerConfig),
      ...extraEnv,
    },
  });

  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  const stderrChunks = [];
  let stdoutBuffer = "";
  let sendChain = Promise.resolve();
  let turnsSent = 0;
  let timedOut = false;
  let settled = false;
  let timeoutId = null;

  const killProcessTree = () => {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // ignore
    }
    try {
      execFileSync("pkill", ["-TERM", "-P", String(child.pid)]);
    } catch {
      // ignore
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // ignore
      }
      try {
        execFileSync("pkill", ["-KILL", "-P", String(child.pid)]);
      } catch {
        // ignore
      }
    }, 1500);
  };

  const finalize = (handler) => {
    if (settled) return;
    settled = true;
    if (timeoutId) clearTimeout(timeoutId);
    handler();
  };

  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  child.stdout.on("data", (chunk) => {
    if (timedOut) return;
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const turn = parseTurnLine(line);
      if (!turn) continue;
      sendChain = sendChain.then(() =>
        sendSingleReply(clientsByAgentId, channelId, turn.agentId, turn.text).then(async () => {
          turnsSent += 1;
          if (timedOut) {
            return;
          }
          if (perTurnDelayMs > 0) {
            await sleep(perTurnDelayMs);
          }
        })
      );
    }
  });

  return await new Promise((resolve, reject) => {
    if (processingTimeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        killProcessTree();
        finalize(() =>
          reject(
            new Error(
              `room round exceeded ${processingTimeoutMs}ms; the controller stopped waiting and asked Discord to try again later`
            )
          )
        );
      }, processingTimeoutMs);
    }

    child.on("error", reject);
    child.on("close", (code) => {
      sendChain
        .then(() => {
          if (timedOut) {
            return;
          }
          const finalTurn = parseTurnLine(stdoutBuffer);
          if (!finalTurn) {
            return;
          }
          return sendSingleReply(clientsByAgentId, channelId, finalTurn.agentId, finalTurn.text).then(() => {
            turnsSent += 1;
          });
        })
        .then(() => {
          if (timedOut) {
            return;
          }
          if (code === 0) {
            finalize(() => resolve({ turnsSent }));
            return;
          }
          const stderr = stderrChunks.join("").trim();
          finalize(() => reject(new Error(stderr || `team-room exited with code ${code}`)));
        })
        .catch((error) => {
          if (timedOut) {
            return;
          }
          finalize(() => reject(error));
        });
    });
  });
}

function collectTeamTextAliases(config, teamId, clientsByAgentId, index) {
  const aliases = new Map();

  for (const [alias, agentId] of Object.entries(config.discord.aliases?.[teamId] || {})) {
    aliases.set(alias, agentId);
  }

  for (const agentId of index.teams?.[teamId]?.agentIds || []) {
    const client = clientsByAgentId?.get?.(agentId);
    const username = client?.user?.username?.trim?.();
    const globalName = client?.user?.globalName?.trim?.();

    if (username) {
      aliases.set(`@${username}`, agentId);
    }
    if (globalName) {
      aliases.set(`@${globalName}`, agentId);
    }
  }

  return aliases;
}

function resolveAliasMentions(config, teamId, messageText, clientsByAgentId, index) {
  const aliases = collectTeamTextAliases(config, teamId, clientsByAgentId, index);
  const haystack = normalizeText(messageText);
  const matches = [];
  for (const [alias, agentId] of aliases.entries()) {
    if (haystack.includes(normalizeText(alias))) {
      matches.push(agentId);
    }
  }
  return [...new Set(matches)];
}

function getMentionedTeamAgentId(message, teamId, botUserIdToAgentId, index) {
  const mentionedAgentIds = [];
  for (const user of message.mentions.users.values()) {
    const agentId = botUserIdToAgentId.get(user.id);
    if (!agentId) continue;
    if (index.agents?.[agentId]?.teamId !== teamId) continue;
    mentionedAgentIds.push(agentId);
  }
  if (mentionedAgentIds.length === 1) {
    return mentionedAgentIds[0];
  }
  return null;
}

function getMentionedTeamAgentIds(message, teamId, botUserIdToAgentId, index) {
  const mentionedAgentIds = [];
  for (const user of message?.mentions?.users?.values?.() || []) {
    const agentId = botUserIdToAgentId.get(user.id);
    if (!agentId) continue;
    if (index.agents?.[agentId]?.teamId !== teamId) continue;
    mentionedAgentIds.push(agentId);
  }
  return [...new Set(mentionedAgentIds)];
}

function getForcedAgentIdsFromRoute(config, route, index, message, botUserIdToAgentId, text, clientsByAgentId) {
  const normalized = normalizeText(text);
  if (normalized.includes("@everyone") || normalized.includes("@here") || Boolean(message?.mentions?.everyone)) {
    return [...index.teams[route.teamId].agentIds];
  }
  return [
    ...new Set([
      ...getMentionedTeamAgentIds(message, route.teamId, botUserIdToAgentId, index),
      ...resolveAliasMentions(config, route.teamId, text, clientsByAgentId, index),
    ]),
  ];
}

async function addWorkingReaction(message, enabled) {
  if (!enabled) return null;
  try {
    return await message.react("👀");
  } catch {
    return null;
  }
}

function buildPresenceConfig(config) {
  const presence = config.discord.responsePolicy?.presence;
  if (!presence || typeof presence !== "object") {
    return {
      status: "online",
      activities: [{ name: "team prompts", type: ActivityType.Watching }],
    };
  }

  const activityName = String(presence.activityName || "").trim();
  const typeMap = {
    playing: ActivityType.Playing,
    streaming: ActivityType.Streaming,
    listening: ActivityType.Listening,
    watching: ActivityType.Watching,
    competing: ActivityType.Competing,
  };

  const activityType = typeMap[String(presence.activityType || "watching").toLowerCase()] ?? ActivityType.Watching;
  const status = ["online", "idle", "dnd", "invisible"].includes(String(presence.status || "").toLowerCase())
    ? String(presence.status).toLowerCase()
    : "online";

  return {
    status,
    activities: activityName ? [{ name: activityName, type: activityType }] : [],
  };
}

async function startTypingLoop(client, channelId, enabled, refreshMs) {
  if (!enabled) {
    return () => {};
  }

  const channel = await resolveWritableChannel(client, channelId);
  let stopped = false;

  const sendTyping = async () => {
    if (stopped) return;
    try {
      await channel.sendTyping();
    } catch {
      // ignore
    }
  };

  await sendTyping();
  const timer = setInterval(() => {
    void sendTyping();
  }, Math.max(5000, refreshMs));

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function startProgressNoticeLoop(client, channelId, enabled, firstNoticeMs, repeatNoticeMs) {
  if (!enabled) {
    return () => {};
  }

  const channel = await resolveWritableChannel(client, channelId);
  let stopped = false;
  let firstTimer = null;
  let repeatTimer = null;
  const startedAt = Date.now();

  function formatElapsed(ms) {
    const totalMinutes = Math.max(1, Math.round(ms / 60000));
    return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  }

  const sendNotice = async () => {
    if (stopped) return;
    try {
      const elapsed = formatElapsed(Date.now() - startedAt);
      await channel.send(
        `Still waiting on a response in this thread after ${elapsed}. No timeout yet, just an unusually long round.`,
      );
    } catch {
      // ignore
    }
  };

  firstTimer = setTimeout(() => {
    if (stopped) return;
    void sendNotice();
    if (repeatNoticeMs > 0) {
      repeatTimer = setInterval(() => {
        void sendNotice();
      }, repeatNoticeMs);
    }
  }, Math.max(5000, firstNoticeMs));

  return () => {
    stopped = true;
    if (firstTimer) clearTimeout(firstTimer);
    if (repeatTimer) clearInterval(repeatTimer);
  };
}

async function clearWorkingReaction(reaction) {
  if (!reaction) return;
  try {
    await reaction.remove();
  } catch {
    // ignore
  }
}

async function resolveWritableChannel(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`channel ${channelId} is not writable as text`);
  }
  return channel;
}

async function sendTurns(clientsByAgentId, channelId, turns, perTurnDelayMs) {
  for (const turn of turns) {
    const client = clientsByAgentId.get(turn.agentId);
    if (!client) {
      throw new Error(`no logged-in Discord client for agent ${turn.agentId}`);
    }
    const channel = await resolveWritableChannel(client, channelId);
    await channel.send(turn.text);
    if (perTurnDelayMs > 0) {
      await sleep(perTurnDelayMs);
    }
  }
}

async function sendSingleReply(clientsByAgentId, channelId, agentId, text) {
  const client = clientsByAgentId.get(agentId);
  if (!client) {
    throw new Error(`no logged-in Discord client for agent ${agentId}`);
  }
  const channel = await resolveWritableChannel(client, channelId);
  await channel.send(text);
}

async function safeSendSingleReply(clientsByAgentId, channelId, agentId, text, context = "send reply") {
  try {
    await sendSingleReply(clientsByAgentId, channelId, agentId, text);
    return true;
  } catch (error) {
    logBrokerError(`${context} (${agentId} -> ${channelId})`, error);
    return false;
  }
}

async function handleIncomingMessage({ bot, client, message, config, index, clientsByAgentId, botUserIdToAgentId, activeChannels }) {
  const route = resolveTeamChannel(config, message.guildId, message.channelId);
  if (message.author.bot && config.discord.responsePolicy?.ignoreBotMessages !== false) {
    return;
  }
  if (!message.guildId) return;
  if (!route) {
    if (config.discord.responsePolicy?.ignoreUnknownChannels) return;
    return;
  }

  const ingressAgentId = route.ingressAgentId || index.teams[route.teamId].facilitatorId;
  if (bot.agentId !== ingressAgentId) {
    return;
  }

  const text = message.content?.trim() || "";
  const forcedAgentIds = getForcedAgentIdsFromRoute(config, route, index, message, botUserIdToAgentId, text, clientsByAgentId);
  if (!text) {
    if (
      forcedAgentIds.length > 0
      && (message.mentions?.everyone || message.mentions?.users?.size > 0)
    ) {
      await safeSendSingleReply(
        clientsByAgentId,
        message.channelId,
        ingressAgentId,
        "I can see the mention, but not the message text. Enable the Discord Message Content intent for these bots, or mention one bot directly with the full request.",
        "missing message content hint",
      );
    }
    return;
  }

  if (activeChannels.has(message.channelId)) {
    await safeSendSingleReply(
      clientsByAgentId,
      message.channelId,
      ingressAgentId,
      "Still waiting on the previous prompt to finish. I’m not starting a second round yet.",
      "busy message",
    );
    return;
  }

  activeChannels.add(message.channelId);

  const reaction = await addWorkingReaction(message, config.discord.responsePolicy?.reactWhileProcessing);
  const stopTyping = await startTypingLoop(
    clientsByAgentId.get(ingressAgentId),
    message.channelId,
    config.discord.responsePolicy?.typingWhileProcessing !== false,
    Number(config.discord.responsePolicy?.typingRefreshMs ?? 8000),
  );
  const stopProgressNotice = await startProgressNoticeLoop(
    clientsByAgentId.get(ingressAgentId),
    message.channelId,
    config.discord.responsePolicy?.progressNotices !== false,
    Number(config.discord.responsePolicy?.progressNoticeAfterMs ?? 20000),
    Number(config.discord.responsePolicy?.progressNoticeRepeatMs ?? 0),
  );
  try {
    const provider = resolveAgentProvider(config);
    const mentionedAgentId = forcedAgentIds.length === 1 ? forcedAgentIds[0] : null;

    const processingTimeoutMs = resolveProcessingTimeoutMs(config, 600000);
    if (mentionedAgentId) {
      const result = provider === "codex-acp"
        ? await runCodexAcpDirect(index, route.teamId, mentionedAgentId, text, processingTimeoutMs)
        : runJsonScript("team-discord-ask.mjs", [mentionedAgentId, text], processingTimeoutMs);
      if (result.reply && result.reply !== "SILENT") {
        await safeSendSingleReply(clientsByAgentId, message.channelId, mentionedAgentId, result.reply, "direct reply");
      } else {
        await safeSendSingleReply(
          clientsByAgentId,
          message.channelId,
          ingressAgentId,
          `Round finished with no visible reply from ${mentionedAgentId}.`,
          "empty direct reply",
        );
      }
    } else {
      const perTurnDelayMs = Number(config.discord.responsePolicy?.perTurnDelayMs ?? 500);
      const roomResult = provider === "codex-acp"
        ? await runCodexAcpRoom(
            index,
            route.teamId,
            text,
            forcedAgentIds,
            perTurnDelayMs,
            processingTimeoutMs,
            (turn) => safeSendSingleReply(clientsByAgentId, message.channelId, turn.agentId, turn.text, "room turn"),
          )
        : await runStreamingRoom(
            clientsByAgentId,
            message.channelId,
            route.teamId,
            text,
            perTurnDelayMs,
            processingTimeoutMs,
            {
              TEAM_AGENT_FORCE_ALL_RESPONSES:
                normalizeText(text).includes("@everyone") || normalizeText(text).includes("@here") ? "1" : "0",
              TEAM_AGENT_FORCE_AGENT_IDS: forcedAgentIds.join(","),
            },
          );
      if ((roomResult?.turnsSent ?? 0) === 0) {
        await safeSendSingleReply(
          clientsByAgentId,
          message.channelId,
          ingressAgentId,
          `Room round finished with no visible reply for ${route.teamId}.`,
          "empty room reply",
        );
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    logBrokerError(`message handler ${message.channelId}`, error);
    await safeSendSingleReply(
      clientsByAgentId,
      message.channelId,
      ingressAgentId,
      `Controller error: ${messageText}`,
      "controller error",
    );
  } finally {
    activeChannels.delete(message.channelId);
    stopProgressNotice();
    stopTyping();
    await clearWorkingReaction(reaction);
  }
}

async function runBroker(routesFileArg) {
  loadDotEnv();
  ensureSingleBrokerInstance();
  const index = loadIndex();
  const { routesFile, config } = loadRoutes(routesFileArg, index);
  globalThis.__discordBrokerConfig = config;
  const errors = validateConfig(config, index);
  if (errors.length > 0) {
    throw new Error(`invalid Discord routes config:\n- ${errors.join("\n- ")}`);
  }

  const bots = config.discord.bots;
  const missingEnvVars = bots
    .filter((entry) => !process.env[entry.tokenEnvVar])
    .map((entry) => `${entry.agentId} -> ${entry.tokenEnvVar}`);
  if (missingEnvVars.length > 0) {
    throw new Error(`missing bot tokens:\n- ${missingEnvVars.join("\n- ")}`);
  }

  const clientsByAgentId = new Map();
  const botUserIdToAgentId = new Map();
  const activeChannels = new Set();

  for (const bot of bots) {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel],
    });
    clientsByAgentId.set(bot.agentId, client);
  }

  for (const bot of bots) {
    const client = clientsByAgentId.get(bot.agentId);
    client.once("clientReady", () => {
      if (client.user) {
        botUserIdToAgentId.set(client.user.id, bot.agentId);
        try {
          client.user.setPresence(buildPresenceConfig(config));
        } catch {
          // ignore
        }
        console.log(`discord bot connected: ${bot.agentId} as ${client.user.tag}`);
      }
    });
  }

  for (const bot of bots) {
    const client = clientsByAgentId.get(bot.agentId);
    client.on("messageCreate", (message) => {
      void handleIncomingMessage({
        bot,
        client,
        message,
        config,
        index,
        clientsByAgentId,
        botUserIdToAgentId,
        activeChannels,
      }).catch((error) => {
        logBrokerError(`unhandled messageCreate ${message.channelId}`, error);
      });
    });
  }

  for (const bot of bots) {
    const client = clientsByAgentId.get(bot.agentId);
    try {
      await client.login(process.env[bot.tokenEnvVar]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to log in ${bot.agentId}: ${message}`);
    }
  }

  console.log(`multi-bot meeting controller ready using routes file: ${routesFile}`);
}

async function runInject(routesFileArg, channelOrTeamId, messageText) {
  loadDotEnv();
  const index = loadIndex();
  const { routesFile, config } = loadRoutes(routesFileArg, index);
  globalThis.__discordBrokerConfig = config;
  const errors = validateConfig(config, index);
  if (errors.length > 0) {
    throw new Error(`invalid Discord routes config:\n- ${errors.join("\n- ")}`);
  }

  if (!channelOrTeamId) {
    throw new Error("inject requires a channel id or team id");
  }
  if (!messageText.trim()) {
    throw new Error("inject requires a non-empty message");
  }

  const route = resolveRouteForInject(config, index, channelOrTeamId);
  if (!route) {
    throw new Error(`no configured Discord route found for '${channelOrTeamId}'`);
  }

  const ingressAgentId = route.ingressAgentId || index.teams[route.teamId].facilitatorId;
  const forcedAgentIds = getForcedAgentIdsFromRoute(config, route, index, null, new Map(), messageText, null);
  const mentionedAgentId = forcedAgentIds.length === 1 ? forcedAgentIds[0] : null;
  const processingTimeoutMs = resolveProcessingTimeoutMs(config, 120000);
  const provider = resolveAgentProvider(config);

  console.log(`inject routes file: ${routesFile}`);
  console.log(`inject target: ${channelOrTeamId}`);
  console.log(`inject resolved team: ${route.teamId}`);
  console.log(`inject ingress agent: ${ingressAgentId}`);
  console.log(`inject provider: ${provider}`);

  if (mentionedAgentId) {
    console.log(`inject direct target: ${mentionedAgentId}`);
    const result = provider === "codex-acp"
      ? await runCodexAcpDirect(index, route.teamId, mentionedAgentId, messageText, processingTimeoutMs)
      : runJsonScript("team-discord-ask.mjs", [mentionedAgentId, messageText], processingTimeoutMs);
    if (result.reply && result.reply !== "SILENT") {
      console.log(`${mentionedAgentId}: ${result.reply}`);
      if (provider === "codex-acp") await closeCodexAcpProviderIfStarted();
      return;
    }
    console.log(`No visible reply from ${mentionedAgentId}.`);
    if (provider === "codex-acp") await closeCodexAcpProviderIfStarted();
    return;
  }

  if (provider === "codex-acp") {
    const roomResult = await runCodexAcpRoom(
      index,
      route.teamId,
      messageText,
      forcedAgentIds,
      Number(config.discord.responsePolicy?.perTurnDelayMs ?? 500),
      processingTimeoutMs,
      (turn) => {
        console.log(`${turn.agentId}: ${turn.text}`);
      },
    );
    if ((roomResult?.turnsSent ?? 0) === 0) {
      console.log(`Room round finished with no visible reply for ${route.teamId}.`);
    }
    await closeCodexAcpProviderIfStarted();
    return;
  }

  const scriptPath = path.join(ROOT, "scripts", "team-room");
  const child = spawn(scriptPath, [route.teamId, messageText], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...buildAgentDiscordEnv(config),
      TEAM_AGENT_FORCE_ALL_RESPONSES:
        normalizeText(messageText).includes("@everyone") || normalizeText(messageText).includes("@here") ? "1" : "0",
      TEAM_AGENT_FORCE_AGENT_IDS: forcedAgentIds.join(","),
    },
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let turnsSent = 0;

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      turnsSent += 1;
      console.log(trimmed);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
  });

  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      const finalLine = stdoutBuffer.trim();
      if (finalLine) {
        turnsSent += 1;
        console.log(finalLine);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderrBuffer.trim() || `team-room exited with code ${code}`));
    });
  });

  if (turnsSent === 0) {
    console.log(`Room round finished with no visible reply for ${route.teamId}.`);
  }
}

function runValidate(routesFileArg) {
  loadDotEnv();
  const index = loadIndex();
  const { routesFile, config } = loadRoutes(routesFileArg, index);
  const errors = validateConfig(config, index);
  if (errors.length > 0) {
    console.error(`invalid: ${routesFile}`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`valid: ${routesFile}`);
  if (config.discord.guildId) {
    console.log(`default guild: ${config.discord.guildId}`);
  } else {
    console.log("default guild: (none; every route must define guildId)");
  }
  for (const entry of config.discord.channels) {
    const ingressAgentId = entry.ingressAgentId || index.teams[entry.teamId].facilitatorId;
    const guildId = resolveRouteGuildId(config, entry) || "(missing)";
    console.log(`guild ${guildId} channel ${entry.channelId} -> team ${entry.teamId} via ingress ${ingressAgentId}`);
  }
  for (const bot of config.discord.bots) {
    console.log(`bot ${bot.agentId} uses env ${bot.tokenEnvVar}`);
  }
}

function runProviderDoctor(routesFileArg) {
  loadDotEnv();
  const index = loadIndex();
  const { routesFile, config } = loadRoutes(routesFileArg, index);
  globalThis.__discordBrokerConfig = config;
  const errors = validateConfig(config, index);
  if (errors.length > 0) {
    throw new Error(`invalid Discord routes config:\n- ${errors.join("\n- ")}`);
  }

  const provider = resolveAgentProvider(config);
  console.log(`provider: ${provider}`);
  console.log(`routes: ${routesFile}`);

  if (provider === "openclaw") {
    console.log("openclaw provider: configured");
    console.log("note: run ./scripts/teamctl status for container health.");
    return;
  }

  const command = resolveCodexAcpCommand();
  if (!fs.existsSync(command) && command.includes(path.sep)) {
    throw new Error(`codex-acp command not found: ${command}`);
  }
  console.log(`codex-acp command: ${command}`);
  console.log(`teams available: ${Object.keys(index.teams).join(", ")}`);

  const login = spawnSync("codex", ["login", "status"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 128 * 1024,
    timeout: 10000,
    env: process.env,
  });
  if (login.error) {
    throw new Error(`failed to check Codex login status: ${login.error.message}`);
  }
  if ((login.status ?? 0) !== 0) {
    throw new Error(`failed to check Codex login status: ${(login.stderr || login.stdout || "").trim()}`);
  }

  const loginStatus = `${login.stdout || ""}${login.stderr || ""}`.trim();
  console.log(`codex login status: ${loginStatus}`);
  if (!/chatgpt/i.test(loginStatus)) {
    throw new Error("ChatGPT OAuth login required for TEAM_AGENT_PROVIDER=codex-acp; run `codex login`.");
  }
  console.log("codex-acp provider: ready");
}

const command = process.argv[2];
const routesFileArg = process.argv[3];
const injectTarget = process.argv[4];
const injectMessage = process.argv.slice(5).join(" ");

process.on("unhandledRejection", (error) => {
  logBrokerError("unhandled rejection", error);
});

process.on("uncaughtException", (error) => {
  logBrokerError("uncaught exception", error);
  process.exit(1);
});

if (!command || ["-h", "--help", "help"].includes(command)) {
  usage();
  process.exit(command ? 0 : 1);
}

try {
  if (command === "validate") {
    runValidate(routesFileArg);
  } else if (command === "run") {
    await runBroker(routesFileArg);
  } else if (command === "inject") {
    await runInject(routesFileArg, injectTarget, injectMessage);
  } else if (command === "provider-doctor") {
    runProviderDoctor(routesFileArg);
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  await closeCodexAcpProviderIfStarted();
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
