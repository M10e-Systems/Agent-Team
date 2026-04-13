#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadRegisteredTeams } from "./lib/team-registry.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const routesPath = path.join(ROOT, "discord.routes.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateRegistry() {
  const teams = loadRegisteredTeams(ROOT);
  assert(teams.length > 0, "team discovery must find at least one enabled team");
}

function main() {
  validateRegistry();
  assert(fs.existsSync(routesPath), "missing discord.routes.json");
  execFileSync("node", [path.join(ROOT, "scripts", "instantiate-openclaw-teams.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  execFileSync("node", [path.join(ROOT, "scripts", "discord-broker.mjs"), "validate", routesPath], {
    cwd: ROOT,
    stdio: "inherit",
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
