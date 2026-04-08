#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_ROOT = path.resolve(SCRIPT_DIR, "..");
const REGISTRY_PATH = fs.existsSync(path.join(TOOLS_ROOT, "teams.local.json"))
  ? path.join(TOOLS_ROOT, "teams.local.json")
  : path.join(TOOLS_ROOT, "teams.json");
const OUTPUT_DIR = path.join(TOOLS_ROOT, "runtime");
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const SOURCE_AUTH_PROFILES = path.join(OPENCLAW_HOME, "agents/main/agent/auth-profiles.json");
const SOURCE_MODELS = path.join(OPENCLAW_HOME, "agents/main/agent/models.json");
const SOURCE_CONFIG = path.join(OPENCLAW_HOME, "openclaw.json");
const IMAGE = process.env.OPENCLAW_IMAGE || "openclaw:local";

const sourceConfig = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8"));
const authProfilesJson = fs.readFileSync(SOURCE_AUTH_PROFILES, "utf8");
const modelsJson = fs.readFileSync(SOURCE_MODELS, "utf8");
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

function resolveRepoPath(repoPath) {
  if (!repoPath) {
    throw new Error("missing repoPath in teams registry");
  }
  return path.isAbsolute(repoPath) ? repoPath : path.resolve(TOOLS_ROOT, repoPath);
}

function relativizeRepoPath(repoPath) {
  return path.relative(TOOLS_ROOT, repoPath) || ".";
}

function mkdirp(target) {
  fs.mkdirSync(target, { recursive: true });
}

function writeFile(target, contents) {
  mkdirp(path.dirname(target));
  fs.writeFileSync(target, contents, "utf8");
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function buildOpenClawConfig() {
  return {
    agents: {
      defaults: {
        workspace: "/home/node/.openclaw/workspace",
        models: sourceConfig.agents?.defaults?.models ?? {
          "openai-codex/gpt-5.4": {},
          "openai-codex/gpt-5.1-codex-mini": {}
        },
        model: {
          primary: "openai-codex/gpt-5.1-codex-mini"
        },
        sandbox: {
          mode: "non-main",
          scope: "agent",
          workspaceAccess: "none"
        }
      }
    },
    gateway: {
      mode: "local",
      auth: {
        mode: "token",
        token: crypto.randomBytes(24).toString("hex")
      },
      port: 18789,
      bind: "loopback",
      tailscale: {
        mode: "off",
        resetOnExit: false
      },
      nodes: {
        denyCommands: [
          "camera.snap",
          "camera.clip",
          "screen.record",
          "contacts.add",
          "calendar.add",
          "reminders.add",
          "sms.send",
          "sms.search"
        ]
      }
    },
    session: {
      dmScope: "per-channel-peer"
    },
    tools: {
      profile: "coding",
      web: {
        search: {
          provider: "duckduckgo",
          enabled: true
        }
      }
    },
    auth: {
      profiles: sourceConfig.auth?.profiles ?? {}
    },
    plugins: {
      entries: {
        duckduckgo: {
          enabled: true
        }
      }
    },
    skills: {
      install: {
        nodeManager: "npm"
      }
    },
    hooks: {
      internal: {
        enabled: true,
        entries: {
          "session-memory": {
            enabled: true
          }
        }
      }
    }
  };
}

const composeLines = ["services:"];
const teamIndex = { teams: {}, agents: {} };

for (const teamEntry of registry.teams) {
  const repoPath = resolveRepoPath(teamEntry.repoPath);
  const team = readJson(path.join(repoPath, "team.json"));
  const mounts = team.projectMounts ?? [];
  teamIndex.teams[team.teamId] = {
    repoPath: relativizeRepoPath(repoPath),
    facilitatorId: team.facilitatorId,
    agentIds: team.agents.map((agent) => agent.id)
  };

  for (const agent of team.agents) {
    const stateDir = path.join(repoPath, "runtime", agent.id, "state");
    const workspaceDir = path.join(stateDir, "workspace");
    const mainAgentDir = path.join(stateDir, "agents", "main", "agent");
    const checkedInWorkspaceDir = path.join(repoPath, "agents", agent.id, "workspace");
    const sharedDir = path.join(repoPath, "shared");

    mkdirp(workspaceDir);
    mkdirp(mainAgentDir);

    writeFile(path.join(stateDir, "openclaw.json"), `${JSON.stringify(buildOpenClawConfig(), null, 2)}\n`);
    writeFile(path.join(mainAgentDir, "auth-profiles.json"), authProfilesJson);
    writeFile(path.join(mainAgentDir, "models.json"), modelsJson);

    for (const fileName of fs.readdirSync(checkedInWorkspaceDir)) {
      const source = path.join(checkedInWorkspaceDir, fileName);
      const target = path.join(workspaceDir, fileName);
      fs.copyFileSync(source, target);
    }
    for (const fileName of fs.readdirSync(sharedDir)) {
      const source = path.join(sharedDir, fileName);
      const target = path.join(workspaceDir, fileName);
      fs.copyFileSync(source, target);
    }

    composeLines.push(`  ${agent.id}:`);
    composeLines.push(`    image: ${IMAGE}`);
    composeLines.push(`    container_name: openclaw-${agent.id}`);
    composeLines.push(`    restart: unless-stopped`);
    composeLines.push(`    command: ["sleep", "infinity"]`);
    composeLines.push(`    healthcheck:`);
    composeLines.push(`      test: ["CMD", "true"]`);
    composeLines.push(`    volumes:`);
    composeLines.push(`      - ${path.relative(OUTPUT_DIR, stateDir)}:/home/node/.openclaw`);
    for (const mount of mounts) {
      const hostPath = mount.hostPath || (mount.hostPathEnv ? process.env[mount.hostPathEnv] : null);
      if (!hostPath) continue;
      composeLines.push(
        `      - ${hostPath}:${mount.containerPath}${mount.mode ? `:${mount.mode}` : ""}`,
      );
    }

    teamIndex.agents[agent.id] = {
      teamId: team.teamId,
      repoPath: relativizeRepoPath(repoPath),
      containerName: `openclaw-${agent.id}`,
      runtimeStateDir: path.relative(TOOLS_ROOT, stateDir),
      isFacilitator: agent.id === team.facilitatorId
    };
  }
}

mkdirp(OUTPUT_DIR);
writeFile(path.join(OUTPUT_DIR, "docker-compose.generated.yml"), `${composeLines.join("\n")}\n`);
writeFile(path.join(OUTPUT_DIR, "team-index.json"), `${JSON.stringify(teamIndex, null, 2)}\n`);
