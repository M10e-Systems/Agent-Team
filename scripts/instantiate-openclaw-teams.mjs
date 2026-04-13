#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadRegisteredTeams } from "./lib/team-registry.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOOLS_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIG_DIR = path.join(TOOLS_ROOT, "config");
const OUTPUT_DIR = path.join(TOOLS_ROOT, "runtime");
const GENERATED_STATE_DIR = path.join(OUTPUT_DIR, "teams");
const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(os.homedir(), ".openclaw");
const SOURCE_AUTH_PROFILES = path.join(OPENCLAW_HOME, "agents/main/agent/auth-profiles.json");
const EMPTY_AUTH_PROFILES = path.join(CONFIG_DIR, "auth-profiles.empty.json");
const SOURCE_MODELS = path.join(CONFIG_DIR, "models.json");
const SOURCE_CONFIG = path.join(CONFIG_DIR, "runtime-defaults.json");
const IMAGE = process.env.OPENCLAW_IMAGE || "openclaw:local";

const sourceConfig = JSON.parse(fs.readFileSync(SOURCE_CONFIG, "utf8"));
const authProfilesJson = fs.existsSync(SOURCE_AUTH_PROFILES)
  ? fs.readFileSync(SOURCE_AUTH_PROFILES, "utf8")
  : fs.readFileSync(EMPTY_AUTH_PROFILES, "utf8");
const modelsJson = fs.readFileSync(SOURCE_MODELS, "utf8");
const registry = loadRegisteredTeams(TOOLS_ROOT);

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
  const config = JSON.parse(JSON.stringify(sourceConfig));
  config.gateway.auth.token = crypto.randomBytes(24).toString("hex");
  return config;
}

const composeLines = ["services:"];
const teamIndex = { teams: {}, agents: {} };

fs.rmSync(GENERATED_STATE_DIR, { recursive: true, force: true });

for (const teamEntry of registry) {
  const repoPath = teamEntry.repoPath;
  const team = teamEntry.team;
  const mounts = team.projectMounts ?? [];
  teamIndex.teams[team.teamId] = {
    repoPath: relativizeRepoPath(repoPath),
    facilitatorId: team.facilitatorId,
    agentIds: team.agents.map((agent) => agent.id)
  };

  for (const agent of team.agents) {
    const stateDir = path.join(GENERATED_STATE_DIR, team.teamId, agent.id);
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
