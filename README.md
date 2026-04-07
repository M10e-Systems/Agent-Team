# OpenClaw Team Tools

Tools for running multi-agent Discord team rooms with one visible bot identity per specialist. The current Discord hot path uses Codex ACP by default, while the original OpenClaw container runtime remains available as a legacy fallback and comparison target.

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
