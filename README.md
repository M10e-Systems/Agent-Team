# OpenClaw Team Tools

Tools for running multi-agent Discord team rooms with one visible bot identity per specialist. The current Discord hot path uses Codex ACP by default, while the original OpenClaw container runtime remains available as a legacy fallback and comparison target.

## Motivation

This repo started as an OpenClaw runtime harness and has now become a Discord room controller with provider-neutral agent identity and memory sources.

The current shape exists to solve three problems:

- keep specialist personas stable across turns
- make Discord feel like a real room instead of a stuck worker queue
- keep the original OpenClaw ideas that still work, while removing the expensive runtime from the live chat path

The result is intentionally pragmatic:

- Codex ACP is the default turn provider for Discord
- OpenClaw stays available for comparison and legacy commands
- persona, memory, and behavioral contracts live in the team repos, not in a hidden runtime home

## Theory Of Operation

The repo has three layers:

1. Team repos store the durable agent identity files, shared discussion contracts, and memory notes.
2. `scripts/teamctl` and `scripts/discord-broker.mjs` resolve a team/channel, choose a provider, and run the turn.
3. Discord bot identities publish the visible response back into the room.

For Discord, the important boundary is:

- the controller owns routing, typing/progress UX, and provider choice
- the provider owns the actual response generation
- the team repo owns the persona and memory inputs

That lets us change the runtime under the bots without rewriting the room model itself.

## Prerequisites

For the default Discord provider:

- Node.js and the project dependencies installed with `npm install`
- `codex login` completed on this machine so `codex login status` reports ChatGPT login
- a local `.env` file with the Discord bot tokens for the active team
- `discord.routes.json` created from `discord.routes.example.json`

For the legacy OpenClaw commands:

- Docker
- the generated OpenClaw runtime from `./scripts/instantiate-openclaw-teams.mjs`

## Repos

- Team A repo: `../openclaw-team-example-team-a-launch`
- Team B repo: `../openclaw-team-example-team-b`

## Main commands

- Regenerate the legacy OpenClaw runtime homes and compose:
  - `./scripts/instantiate-openclaw-teams.mjs`
- Preferred operator entrypoint:
  - `./scripts/teamctl`
- Start all legacy team containers:
  - `docker compose -f ./runtime/docker-compose.generated.yml up -d`
- Stop all legacy team containers:
  - `docker compose -f ./runtime/docker-compose.generated.yml down`
- Talk to one legacy container:
  - `./scripts/openclaw-instance example-team-a-facilitator agent --local --agent main --message "What are you watching?"`
- Run a legacy room round:
  - `./scripts/team-room example-team-a "What is the next best launch move?"`
- Run a legacy team heartbeat:
  - `./scripts/team-heartbeat example-team-b`
- Initialize Discord routing config:
  - `./scripts/teamctl discord-init`
- Validate Discord routing config:
  - `./scripts/teamctl discord-validate`
- Check the selected Discord agent provider:
  - `./scripts/teamctl discord-provider-doctor`
- Test a Discord-routed prompt locally:
  - `./scripts/teamctl discord-inject example-team-a "@architect What risk are we underestimating?"`
- Run the Discord broker:
  - `./scripts/teamctl discord-run`
- Run the legacy OpenClaw provider explicitly:
  - `TEAM_AGENT_PROVIDER=openclaw ./scripts/teamctl discord-inject example-team-a "@architect What risk are we underestimating?"`

## Notes

- Canonical persona and memory files live in the team repos, not in `~/.openclaw`.
- Discord turns default to `TEAM_AGENT_PROVIDER=codex-acp` and use the local Codex ChatGPT OAuth login.
- Runtime state is generated into each team repo's `runtime/` directory and is not tracked in git.
- See `MANAGEMENT.md` for the addressing model, dashboard rationale, and day-to-day commands.
- See `DISCORD.md` for the Discord broker model, channel routing, and setup flow.
- See `PROJECT_STATE.md` for the current reopen/handoff state of this repo.
