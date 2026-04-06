#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const TOOLS_ROOT = "/workspace/agent-team-tools";
const REGISTRY_PATH = path.join(TOOLS_ROOT, "teams.json");
const OUTPUT_DIR = path.join(TOOLS_ROOT, "runtime");
const SOURCE_AUTH_PROFILES = "~/.openclaw/agents/main/agent/auth-profiles.json";
const SOURCE_MODELS = "~/.openclaw/agents/main/agent/models.json";
const SOURCE_CONFIG = "~/.openclaw/openclaw.json";
const IMAGE = "openclaw:local";

const sourceConfig = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8"));
const authProfilesJson = fs.readFileSync(SOURCE_AUTH_PROFILES, "utf8");
const modelsJson = fs.readFileSync(SOURCE_MODELS, "utf8");
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));

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
  const repoPath = teamEntry.repoPath;
  const team = readJson(path.join(repoPath, "team.json"));
  const mounts = team.projectMounts ?? [];
  teamIndex.teams[team.teamId] = {
    repoPath,
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
    composeLines.push(`      - ${stateDir}:/home/node/.openclaw`);
    for (const mount of mounts) {
      composeLines.push(
        `      - ${mount.hostPath}:${mount.containerPath}${mount.mode ? `:${mount.mode}` : ""}`,
      );
    }

    teamIndex.agents[agent.id] = {
      teamId: team.teamId,
      repoPath,
      containerName: `openclaw-${agent.id}`,
      runtimeStateDir: stateDir,
      isFacilitator: agent.id === team.facilitatorId
    };
  }
}

mkdirp(OUTPUT_DIR);
writeFile(path.join(OUTPUT_DIR, "docker-compose.generated.yml"), `${composeLines.join("\n")}\n`);
writeFile(path.join(OUTPUT_DIR, "team-index.json"), `${JSON.stringify(teamIndex, null, 2)}\n`);
