# Reference

## Repository Files

- `README.md` is the landing page
- `docs/agent-teams.md` covers the concept
- `docs/build-and-operate.md` covers setup and operation
- `docs/productivity-field-guide.md` covers field use
- `docs/reference.md` is the compact implementation reference
- Internal handoff/status artifacts are intentionally kept out of the public documentation suite

## Team Registry

`teams.json` contains:

- `teams[]`
- `teamId`
- `repoPath`

## Team Repo Contract

The current docs assume each team repo provides:

- `team.json`
- `agents/<agent-id>/workspace/`
- `shared/`

## Discord Routes Schema

`discord.routes.example.json` documents the public shape of the Discord routing config.

Important fields:

- `discord.guildId`
- `discord.bots[]`
- `discord.channels[]`
- `discord.aliases`
- `discord.responsePolicy`

`discord.guildId` is now a default guild id. Individual `discord.channels[]` entries may also define `guildId` to route a team through a different Discord server while sharing the same broker config.

The example uses `agentProvider: "codex-acp"` in its response policy.

## Provider Environment Variables

- `TEAM_AGENT_PROVIDER` accepts `codex-acp` and `openclaw`
- `TEAM_AGENT_TIMEOUT_MS` controls turn timeout where the broker honors it
- `TEAM_CODEX_ACP_COMMAND` overrides the Codex ACP adapter command when needed
- `TEAM_CODEX_ACP_MODEL` requests a model override when supported

Legacy OpenClaw fallback helpers may still read OpenClaw-named environment variables. Those names are implementation details, not the product identity.

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
- `./scripts/teamctl discord-init`
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

## Legacy Names Still Present

Some implementation names still carry `OpenClaw`:

- `scripts/openclaw-instance`
- `scripts/instantiate-openclaw-teams.mjs`
- `scripts/team-room`
- `scripts/team-heartbeat`
- `scripts/team-room-json.mjs`
- `scripts/team-discord-ask.mjs`
- `scripts/discord-broker.mjs` fallback provider paths

These names remain for compatibility and comparison. They should not be treated as the product identity.
