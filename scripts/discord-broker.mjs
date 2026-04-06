#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
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
const ENV_FILE = path.join(ROOT, ".env");
const PID_FILE = path.join(ROOT, "runtime", "discord-broker.pid");

function usage() {
  console.error("usage:");
  console.error("  node scripts/discord-broker.mjs validate [routes-file]");
  console.error("  node scripts/discord-broker.mjs run [routes-file]");
  console.error("  node scripts/discord-broker.mjs inject <routes-file> <channel-id|team-id> <message...>");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadDotEnv() {
  if (!fs.existsSync(ENV_FILE)) return;
  const lines = fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
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

function loadRoutes(routesFileArg) {
  const routesFile = path.resolve(routesFileArg || path.join(ROOT, "discord.routes.json"));
  if (!fs.existsSync(routesFile)) {
    throw new Error(
      `routes file not found: ${routesFile}\ncopy ${path.join(ROOT, "discord.routes.example.json")} to discord.routes.json and fill in real ids`
    );
  }
  return { routesFile, config: readJson(routesFile) };
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

function validateConfig(config, index) {
  const errors = [];
  const discord = config.discord;
  if (!discord || typeof discord !== "object") {
    errors.push("missing top-level discord object");
    return errors;
  }
  if (!discord.guildId || typeof discord.guildId !== "string") {
    errors.push("discord.guildId must be a string");
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
      if (!entry.channelId || typeof entry.channelId !== "string") {
        errors.push(`discord.channels[${idx}].channelId must be a string`);
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

function resolveTeamChannel(config, channelId) {
  return (config.discord.channels || []).find((entry) => entry.channelId === channelId) || null;
}

function resolveRouteForInject(config, index, target) {
  const byChannel = resolveTeamChannel(config, target);
  if (byChannel) return byChannel;
  if (index.teams?.[target]) {
    return (config.discord.channels || []).find((entry) => entry.teamId === target) || null;
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildOpenClawDiscordEnv(config) {
  const policy = config.discord.responsePolicy || {};
  return {
    ...process.env,
    OPENCLAW_DISCORD_THINKING: String(policy.openclawThinking || process.env.OPENCLAW_DISCORD_THINKING || "off"),
    OPENCLAW_AGENT_TIMEOUT: String(policy.openclawAgentTimeoutSec || process.env.OPENCLAW_AGENT_TIMEOUT || "45"),
    OPENCLAW_WALL_TIMEOUT: String(policy.openclawWallTimeout || process.env.OPENCLAW_WALL_TIMEOUT || "90s"),
  };
}

function runJsonScript(scriptName, args, timeoutMs) {
  const stdout = execFileSync(path.join(ROOT, "scripts", scriptName), args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGTERM",
    env: buildOpenClawDiscordEnv(globalThis.__discordBrokerConfig),
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
      ...buildOpenClawDiscordEnv(globalThis.__discordBrokerConfig),
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

function resolveAliasMention(config, teamId, messageText) {
  const aliases = config.discord.aliases?.[teamId] || {};
  const haystack = normalizeText(messageText);
  for (const [alias, agentId] of Object.entries(aliases)) {
    if (haystack.includes(normalizeText(alias))) {
      return agentId;
    }
  }
  return null;
}

function resolveAliasMentions(config, teamId, messageText) {
  const aliases = config.discord.aliases?.[teamId] || {};
  const haystack = normalizeText(messageText);
  const matches = [];
  for (const [alias, agentId] of Object.entries(aliases)) {
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

function getForcedAgentIdsFromRoute(config, route, index, message, botUserIdToAgentId, text) {
  const normalized = normalizeText(text);
  if (normalized.includes("@everyone") || normalized.includes("@here") || Boolean(message?.mentions?.everyone)) {
    return [...index.teams[route.teamId].agentIds];
  }
  return [
    ...new Set([
      ...getMentionedTeamAgentIds(message, route.teamId, botUserIdToAgentId, index),
      ...resolveAliasMentions(config, route.teamId, text),
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

  const sendNotice = async () => {
    if (stopped) return;
    try {
      await channel.send("Still working on this one. No hang yet, just taking a bit longer.");
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

async function runBroker(routesFileArg) {
  loadDotEnv();
  ensureSingleBrokerInstance();
  const { routesFile, config } = loadRoutes(routesFileArg);
  globalThis.__discordBrokerConfig = config;
  const index = loadIndex();
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
    client.on("messageCreate", async (message) => {
      const route = resolveTeamChannel(config, message.channelId);
      if (message.author.bot && config.discord.responsePolicy?.ignoreBotMessages !== false) {
        return;
      }
      if (!message.guildId || message.guildId !== config.discord.guildId) return;
      if (!route) {
        if (config.discord.responsePolicy?.ignoreUnknownChannels) return;
        return;
      }

      const ingressAgentId = route.ingressAgentId || index.teams[route.teamId].facilitatorId;
      if (bot.agentId !== ingressAgentId) {
        return;
      }

      const text = message.content?.trim();
      if (!text) return;

      if (activeChannels.has(message.channelId)) {
        const ingressClient = clientsByAgentId.get(ingressAgentId);
        if (ingressClient) {
          const channel = await resolveWritableChannel(ingressClient, message.channelId);
          await channel.send("Still working on the previous prompt. I’m keeping the busy signal on and will post when this round finishes.");
        }
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
        const forcedAgentIds = getForcedAgentIdsFromRoute(config, route, index, message, botUserIdToAgentId, text);
        const mentionedAgentId = forcedAgentIds.length === 1 ? forcedAgentIds[0] : null;

        const processingTimeoutMs = Number(config.discord.responsePolicy?.processingTimeoutMs ?? 600000);
        if (mentionedAgentId) {
          const result = runJsonScript("team-discord-ask.mjs", [mentionedAgentId, text], processingTimeoutMs);
          if (result.reply && result.reply !== "SILENT") {
            await sendSingleReply(clientsByAgentId, message.channelId, mentionedAgentId, result.reply);
          } else {
            await sendSingleReply(
              clientsByAgentId,
              message.channelId,
              ingressAgentId,
              `Round finished with no visible reply from ${mentionedAgentId}.`,
            );
          }
        } else {
          const roomResult = await runStreamingRoom(
            clientsByAgentId,
            message.channelId,
            route.teamId,
            text,
            Number(config.discord.responsePolicy?.perTurnDelayMs ?? 500),
            processingTimeoutMs,
            {
              OPENCLAW_FORCE_ALL_RESPONSES:
                normalizeText(text).includes("@everyone") || normalizeText(text).includes("@here") ? "1" : "0",
              OPENCLAW_FORCE_AGENT_IDS: forcedAgentIds.join(","),
            },
          );
          if ((roomResult?.turnsSent ?? 0) === 0) {
            await sendSingleReply(
              clientsByAgentId,
              message.channelId,
              ingressAgentId,
              `Room round finished with no visible reply for ${route.teamId}.`,
            );
          }
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        const ingressClient = clientsByAgentId.get(ingressAgentId);
        if (ingressClient) {
          const channel = await resolveWritableChannel(ingressClient, message.channelId);
          await channel.send(`Controller error: ${messageText}`);
        }
      } finally {
        activeChannels.delete(message.channelId);
        stopProgressNotice();
        stopTyping();
        await clearWorkingReaction(reaction);
      }
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
  const { routesFile, config } = loadRoutes(routesFileArg);
  globalThis.__discordBrokerConfig = config;
  const index = loadIndex();
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
  const forcedAgentIds = getForcedAgentIdsFromRoute(config, route, index, null, new Map(), messageText);
  const mentionedAgentId = forcedAgentIds.length === 1 ? forcedAgentIds[0] : null;
  const processingTimeoutMs = Number(config.discord.responsePolicy?.processingTimeoutMs ?? 120000);

  console.log(`inject routes file: ${routesFile}`);
  console.log(`inject target: ${channelOrTeamId}`);
  console.log(`inject resolved team: ${route.teamId}`);
  console.log(`inject ingress agent: ${ingressAgentId}`);

  if (mentionedAgentId) {
    console.log(`inject direct target: ${mentionedAgentId}`);
    const result = runJsonScript("team-discord-ask.mjs", [mentionedAgentId, messageText], processingTimeoutMs);
    if (result.reply && result.reply !== "SILENT") {
      console.log(`${mentionedAgentId}: ${result.reply}`);
      return;
    }
    console.log(`No visible reply from ${mentionedAgentId}.`);
    return;
  }

  const scriptPath = path.join(ROOT, "scripts", "team-room");
  const child = spawn(scriptPath, [route.teamId, messageText], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...buildOpenClawDiscordEnv(config),
      OPENCLAW_FORCE_ALL_RESPONSES:
        normalizeText(messageText).includes("@everyone") || normalizeText(messageText).includes("@here") ? "1" : "0",
      OPENCLAW_FORCE_AGENT_IDS: forcedAgentIds.join(","),
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
  const { routesFile, config } = loadRoutes(routesFileArg);
  const index = loadIndex();
  const errors = validateConfig(config, index);
  if (errors.length > 0) {
    console.error(`invalid: ${routesFile}`);
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`valid: ${routesFile}`);
  console.log(`guild: ${config.discord.guildId}`);
  for (const entry of config.discord.channels) {
    const ingressAgentId = entry.ingressAgentId || index.teams[entry.teamId].facilitatorId;
    console.log(`channel ${entry.channelId} -> team ${entry.teamId} via ingress ${ingressAgentId}`);
  }
  for (const bot of config.discord.bots) {
    console.log(`bot ${bot.agentId} uses env ${bot.tokenEnvVar}`);
  }
}

const command = process.argv[2];
const routesFileArg = process.argv[3];
const injectTarget = process.argv[4];
const injectMessage = process.argv.slice(5).join(" ");

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
  } else {
    usage();
    process.exit(1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
