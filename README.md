# OpenClaw Team Tools

Tools for instantiating and managing multi-container OpenClaw teams where each container owns its own isolated OpenClaw home and its own `main` agent, including a Discord multi-bot meeting controller.

## Repos

- Team A repo: `../openclaw-team-example-team-a-launch`
- Team B repo: `../openclaw-team-example-team-b`

## Main commands

- Regenerate runtime homes and compose:
  - `./scripts/instantiate-openclaw-teams.mjs`
- Preferred operator entrypoint:
  - `./scripts/teamctl`
- Start all team containers:
  - `docker compose -f ./runtime/docker-compose.generated.yml up -d`
- Stop all team containers:
  - `docker compose -f ./runtime/docker-compose.generated.yml down`
- Talk to one container:
  - `./scripts/openclaw-instance example-team-a-facilitator agent --local --agent main --message "What are you watching?"`
- Run a room round:
  - `./scripts/team-room example-team-a "What is the next best launch move?"`
- Run a team heartbeat:
  - `./scripts/team-heartbeat example-team-b`
- Initialize Discord routing config:
  - `./scripts/teamctl discord-init`
- Validate Discord routing config:
  - `./scripts/teamctl discord-validate`
- Run the Discord broker:
  - `./scripts/teamctl discord-run`

## Notes

- Canonical prompts live in the team repos, not in `~/.openclaw`.
- Runtime state is generated into each team repo's `runtime/` directory and is not tracked in git.
- See `MANAGEMENT.md` for the addressing model, dashboard rationale, and day-to-day commands.
- See `DISCORD.md` for the Discord broker model, channel routing, and setup flow.
- See `PROJECT_STATE.md` for the current reopen/handoff state of this repo.
