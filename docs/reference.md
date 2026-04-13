# Reference

## Repository Files

- `README.md` is the landing page
- `docs/agent-teams.md` covers the concept
- `docs/build-and-operate.md` covers setup and operation
- `docs/productivity-field-guide.md` covers field use
- `docs/reference.md` is the compact implementation reference
- `config/runtime-defaults.json` defines the generated runtime defaults
- `config/team-discovery.json` defines discovery roots and optional explicit repo paths
- `config/models.json` defines generated model-provider metadata
- `.env.example` documents local secret requirements
- Internal handoff/status artifacts are intentionally kept out of the public documentation suite

## Team Discovery

`config/team-discovery.json` contains:

- `roots[]`
- `explicitRepoPaths[]`

`roots[]` supports self-registration discovery.
`explicitRepoPaths[]` is the built-in bridge to a future fully explicit repo-list model.

## Team Repo Contract

The current docs assume each team repo provides:

- `team.json`
- `agents/<agent-id>/workspace/`
- `shared/`
- `operator/team-tools.json`
- `operator/discord.json`

## Discord Routes Schema

`discord.routes.json` is the source-controlled engine-wide Discord defaults file.

Important fields:

- `discord.responsePolicy`

Per-team Discord config now lives in each team repo under `operator/discord.json`.

Important team-level fields:

- `discord.guildId`
- `discord.bots[]`
- `discord.channels[]`
- `discord.aliases`

The broker merges the engine defaults from `openclaw-team-tools/discord.routes.json` with each team's `operator/discord.json`.

## Team Registration

Each team repo self-registers with `operator/team-tools.json`.

Important fields:

- `teamId`
- `enabled`

## Provider Environment Variables

- `.env` is the only local secrets file loaded automatically
- `TEAM_AGENT_PROVIDER` accepts `codex-acp` and `openclaw`
- `TEAM_AGENT_TIMEOUT_MS` controls processing timeout in millisecond-based callers
- `TEAM_AGENT_TIMEOUT` controls per-turn timeout in second-based callers
- `TEAM_AGENT_WALL_TIMEOUT` controls wall timeout passed through agent invocations
- `TEAM_AGENT_THINKING` controls visible thinking mode where supported
- `TEAM_CODEX_ACP_COMMAND` overrides the Codex ACP adapter command when needed
- `TEAM_CODEX_ACP_MODEL` requests a model override when supported
- `TEAM_AGENT_RUNNER_DEBUG=1` enables stderr passthrough in the Codex ACP runner
- `OPENCLAW_IMAGE`, `OPENCLAW_REPO_PATH`, and `OPENCLAW_DOCKERFILE` only affect container-runtime build commands

## Command Reference

Primary command surface:

- `./scripts/teamctl init`
- `./scripts/teamctl up`
- `./scripts/teamctl down`
- `./scripts/teamctl restart`
- `./scripts/teamctl status`
- `./scripts/teamctl list`
- `./scripts/teamctl ask <agent-id> <message...>`
- `./scripts/teamctl room <team-id> <message...>`
- `./scripts/teamctl heartbeat <team-id> [prompt...]`
- `./scripts/teamctl discord-validate [routes-file]`
- `./scripts/teamctl discord-run [routes-file]`
- `./scripts/teamctl discord-start [routes-file]`
- `./scripts/teamctl discord-stop`
- `./scripts/teamctl discord-status`
- `./scripts/teamctl discord-inject <channel-id|team-id> <message...>`
- `./scripts/teamctl discord-provider-doctor [routes-file]`
- `./scripts/teamctl logs <agent-id>`
- `./scripts/teamctl shell <agent-id>`
- `./scripts/teamctl ps <team-id>`
- `./scripts/teamctl path <agent-id>`
- `./scripts/teamctl dashboard <agent-id>`

## Generated Runtime

- `runtime/team-index.json` is generated from discovered team repos
- `runtime/docker-compose.generated.yml` is generated from the registry and runtime defaults
- `runtime/teams/<team-id>/<agent-id>/...` is generated working state for container/runtime helpers
- Team repos should not treat generated `runtime/` state as authored configuration
