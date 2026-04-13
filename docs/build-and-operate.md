# Build And Operate

## Prerequisites

- Node.js and project dependencies installed with `npm install`
- A prepared `config/team-discovery.json`
- Team repos that provide `team.json`, `agents/<agent-id>/workspace/`, `shared/`, and `operator/discord.json`
- A local `.env` file populated from `.env.example`
- The tracked `discord.routes.json` engine-defaults config
- `codex login` completed when using the default `codex-acp` provider

## Repository Roles

- `config/team-discovery.json` defines discovery roots and optional explicit repo paths
- The team repos are the source of truth for persona, workspace content, and shared discussion contracts
- Each team repo self-registers for discovery in `operator/team-tools.json`
- The team repos also own per-team Discord bot, channel, guild, and alias mappings in `operator/discord.json`
- This tools repo owns routing, orchestration, provider selection, generated runtime state, and surface integration
- Generated runtime state under `runtime/` is a working artifact, not the canonical definition of the team

## Define A Team

Each team repo should provide:

- `team.json`
- `agents/<agent-id>/workspace/`
- `shared/`
- `operator/team-tools.json`
- `operator/discord.json`

The exact workspace file set may vary by team, but the idea is always the same: put durable identity and team behavior in the team repo, not in the operator shell history.

## Register Teams

Use `config/team-discovery.json` to declare:

- `roots[]`
- `explicitRepoPaths[]`

Use `roots[]` for self-registration discovery.
Use `explicitRepoPaths[]` when repo locations start to matter and you want a bridge toward fully explicit repo selection.

Each team repo should add `operator/team-tools.json` with at least:

- `teamId`
- `enabled`

## Configure A Surface

For Discord, update the team-owned `operator/discord.json` files for team-specific routing and the tracked `discord.routes.json` only for engine-wide defaults.

The team-owned files document:

- a team-level guild id plus optional per-channel guild overrides
- bot identities
- channel mappings
- aliases

Keep `responsePolicy` in `openclaw-team-tools/discord.routes.json`.
Use the team-level `discord.guildId` when most routes for that team live in one server.
Add `guildId` on individual channel entries when a route should live in a different Discord server.

Private Discord tokens belong in `.env`, not in any tracked team or tools config file.

The current response-policy knobs are especially useful:

- `reactWhileProcessing`: acknowledge the ingress immediately
- `typingWhileProcessing`: show `is typing...` while work is active
- `typingRefreshMs`: refresh interval for typing state
- `progressNotices`: emit a visible progress message during unusually long turns
- `progressNoticeAfterMs`: delay before the first progress notice
- `progressNoticeRepeatMs`: repeat interval for later progress notices
- `processingTimeoutMs`: fail gracefully if the turn runs too long
- `perTurnDelayMs`: pace streamed room turns
- `presence`: set the visible member-list presence

## Choose A Provider

The current default provider is `codex-acp`.

Set `TEAM_AGENT_PROVIDER` when you want to override the default:

- `TEAM_AGENT_PROVIDER=codex-acp`
- `TEAM_AGENT_PROVIDER=openclaw`

Use `openclaw` only when you intentionally want the legacy helper path for comparison or fallback.

## Validate The Setup

If the runtime index has not been generated yet, run the runtime initializer first:

```bash
./scripts/teamctl init
```

Then validate the Discord surface and the provider:

```bash
./scripts/teamctl discord-validate
./scripts/teamctl discord-provider-doctor
```

## Run Local Tests

Use local injection to exercise the routing logic without writing to Discord:

```bash
./scripts/teamctl discord-inject m10e "We need one concrete next move this week."
./scripts/teamctl discord-inject sparkmill "@builder What asset should we ship next?"
./scripts/teamctl discord-inject m10e "@everyone Everybody say one short marker."
```

Local injection is useful for checking:

- direct asks
- room prompts
- forced-response behavior
- provider readiness
- timeout and progress behavior

## Run The Discord Controller

```bash
./scripts/teamctl discord-run
```

The controller reads the routing file, loads the team material, chooses the provider, and posts results through the matching Discord bot identities.

For managed background operation, use:

```bash
./scripts/teamctl discord-start
./scripts/teamctl discord-status
./scripts/teamctl discord-stop
```

`discord-run` stays attached to the current terminal. `discord-start` launches the broker in the background and writes output to `runtime/discord-broker.log`.

## Operate Day To Day

Common commands:

- `./scripts/teamctl init`
- `./scripts/teamctl up`
- `./scripts/teamctl down`
- `./scripts/teamctl restart`
- `./scripts/teamctl status`
- `./scripts/teamctl list`
- `./scripts/teamctl ask <agent-id> <message...>`
- `./scripts/teamctl room <team-id> <message...>`
- `./scripts/teamctl heartbeat <team-id> [prompt...]`
- `./scripts/teamctl discord-start [routes-file]`
- `./scripts/teamctl discord-stop`
- `./scripts/teamctl discord-status`
- `./scripts/teamctl logs <agent-id>`
- `./scripts/teamctl shell <agent-id>`
- `./scripts/teamctl ps <team-id>`
- `./scripts/teamctl path <agent-id>`
- `./scripts/teamctl dashboard <agent-id>`

Recommended habits:

- use `room` when you want a team discussion
- use `ask` when you want one specialist voice
- use `heartbeat` when you want the facilitator to check in on the team
- use `discord-inject` before live Discord tests when you want to isolate routing or provider behavior

## Troubleshooting

- Missing `runtime/team-index.json`: run `./scripts/teamctl init`
- Missing team Discord routing file: restore `operator/discord.json` in the affected team repo
- Missing engine defaults file: restore `openclaw-team-tools/discord.routes.json` from source control
- Codex ACP not ready: run `codex login` and then `./scripts/teamctl discord-provider-doctor`
- Silent room: silence may be valid for untagged prompts; direct mentions and `@everyone` should still trigger a response or an error
- Slow room: check `typingWhileProcessing`, `progressNotices`, `processingTimeoutMs`, and `perTurnDelayMs`

## Container Runtime Commands

The commands below still operate on the generated OpenClaw/container runtime:

- `./scripts/teamctl up`
- `./scripts/teamctl down`
- `./scripts/teamctl restart`
- `./scripts/teamctl status`
- `./scripts/teamctl ask <agent-id> <message...>`
- `./scripts/teamctl room <team-id> <message...>`
- `./scripts/teamctl heartbeat <team-id> [prompt...]`
- `./scripts/teamctl logs <agent-id>`
- `./scripts/teamctl shell <agent-id>`
- `./scripts/teamctl ps <team-id>`
- `./scripts/teamctl path <agent-id>`
- `./scripts/teamctl dashboard <agent-id>`

`teamctl dashboard` is informational only. It explains that no long-lived dashboard URL is exposed in the current runtime model.
