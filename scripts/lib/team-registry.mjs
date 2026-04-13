import fs from "node:fs";
import path from "node:path";

export const TEAM_SELF_REGISTRATION_RELATIVE_PATH = path.join("operator", "team-tools.json");
export const TEAM_OPERATOR_DISCORD_RELATIVE_PATH = path.join("operator", "discord.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isDirectoryEntry(root, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  return isDirectory(path.join(root, entry.name));
}

function uniqueByRealPath(paths) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    const resolved = fs.realpathSync(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

export function loadTeamDiscoveryConfig(toolsRoot) {
  const configPath = path.join(toolsRoot, "config", "team-discovery.json");
  const config = readJson(configPath);
  return {
    configPath,
    roots: Array.isArray(config.roots) ? config.roots : [],
    explicitRepoPaths: Array.isArray(config.explicitRepoPaths) ? config.explicitRepoPaths : [],
  };
}

export function resolveDiscoveryRepoPaths(toolsRoot, discoveryConfig) {
  const explicit = discoveryConfig.explicitRepoPaths
    .map((repoPath) => (path.isAbsolute(repoPath) ? repoPath : path.resolve(toolsRoot, repoPath)))
    .filter((repoPath) => isDirectory(repoPath));

  const discovered = [];
  for (const root of discoveryConfig.roots) {
    const absoluteRoot = path.isAbsolute(root) ? root : path.resolve(toolsRoot, root);
    if (!isDirectory(absoluteRoot)) continue;
    for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
      if (!isDirectoryEntry(absoluteRoot, entry)) continue;
      const repoPath = path.join(absoluteRoot, entry.name);
      const markerPath = path.join(repoPath, TEAM_SELF_REGISTRATION_RELATIVE_PATH);
      if (fs.existsSync(markerPath)) {
        discovered.push(repoPath);
      }
    }
  }

  return uniqueByRealPath([...explicit, ...discovered]);
}

export function loadRegisteredTeams(toolsRoot) {
  const discoveryConfig = loadTeamDiscoveryConfig(toolsRoot);
  const repoPaths = resolveDiscoveryRepoPaths(toolsRoot, discoveryConfig);
  const teams = [];

  for (const repoPath of repoPaths) {
    const registrationPath = path.join(repoPath, TEAM_SELF_REGISTRATION_RELATIVE_PATH);
    const teamJsonPath = path.join(repoPath, "team.json");
    const operatorDiscordPath = path.join(repoPath, TEAM_OPERATOR_DISCORD_RELATIVE_PATH);

    if (!fs.existsSync(registrationPath)) continue;
    if (!fs.existsSync(teamJsonPath)) {
      throw new Error(`missing team.json for registered repo ${repoPath}`);
    }
    if (!fs.existsSync(operatorDiscordPath)) {
      throw new Error(`missing ${TEAM_OPERATOR_DISCORD_RELATIVE_PATH} for registered repo ${repoPath}`);
    }

    const registration = readJson(registrationPath);
    if (registration.enabled === false) continue;

    const team = readJson(teamJsonPath);
    if (registration.teamId && registration.teamId !== team.teamId) {
      throw new Error(`team registration mismatch in ${registrationPath}: expected ${registration.teamId}, found ${team.teamId}`);
    }

    teams.push({
      teamId: team.teamId,
      repoPath,
      registrationPath,
      registration,
      team,
    });
  }

  return teams.sort((a, b) => a.teamId.localeCompare(b.teamId));
}
