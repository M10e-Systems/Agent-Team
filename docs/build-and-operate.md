# Build And Operate

## Prerequisites

- Node.js and project dependencies installed with `npm install`
- A prepared `teams.json` registry
- Team repos that provide `team.json`, `agents/<agent-id>/workspace/`, and `shared/`
- A local `.env` file for private Discord bot tokens
- `discord.routes.example.json` as the public starting point for Discord routing
- `codex login` completed when using the default `codex-acp` provider

## Repository Roles

- `teams.json` is the local registry of team ids and repo paths
- The team repos are the source of truth for persona, workspace content, and shared discussion contracts
- This tools repo owns routing, orchestration, provider selection, and surface integration
- Generated runtime state is a working artifact, not the canonical definition of the team

## Define A Team

Each team repo should provide:

- `team.json`
- `agents/<agent-id>/workspace/`
- `shared/`

The exact workspace file set may vary by team, but the idea is always the same: put durable identity and team behavior in the team repo, not in the operator shell history.

## Register Teams

Use `teams.json` entries with:

- `teamId`
- `repoPath`

Keep the registry local to this repo. Use redacted or example paths in documentation, not private local IDs copied from live config files.

## Configure A Surface

For Discord, start from `discord.routes.example.json` and write a local `discord.routes.json`.

The example file documents:

- bot identities
- channel mappings
- aliases
- response policy

Private Discord tokens belong in `.env`, not in the public example file.

The current response-policy knobs are especially useful:

- `reactWhileProcessing`: acknowledge the ingress immediately
- `typingWhileProcessing`: show `is typing...` while work is active
- `typingRefreshMs`: refresh interval for typing state
- `progressNotices`: emit a visible progress message during long turns
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
./scripts/teamctl discord-inject example-team-a "We need one concrete next move this week."
./scripts/teamctl discord-inject example-team-a "@architect What risk are we underestimating?"
./scripts/teamctl discord-inject example-team-a "@everyone Everybody say one short marker."
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
- Missing Discord routing file: copy `discord.routes.example.json` to `discord.routes.json`
- Codex ACP not ready: run `codex login` and then `./scripts/teamctl discord-provider-doctor`
- Silent room: silence may be valid for untagged prompts; direct mentions and `@everyone` should still trigger a response or an error
- Slow room: check `typingWhileProcessing`, `progressNotices`, `processingTimeoutMs`, and `perTurnDelayMs`

## Legacy Runtime Commands

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
