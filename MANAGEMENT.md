# Management Model

This toolset uses a simple mental model:

- **Team**: a discussion group like `example-team-a` or `example-team-b`
- **Agent**: one specialist identity like `example-team-a-facilitator`
- **Provider**: the runtime used to produce a reply, currently `codex-acp` by default or `openclaw` explicitly
- **OpenClaw runtime**: generated state plus Docker containers, kept as a legacy fallback/comparison path

## Motivation

The goal is to keep the useful parts of the original OpenClaw setup without forcing Discord traffic through the heaviest part of the stack.

We want:

- stable specialist personalities
- predictable room behavior
- a clear place for memory and behavior contracts
- a room controller that can stay responsive even when the underlying turn provider is slow

The practical outcome is that the team repos become the durable home for identity and memory, while the provider becomes replaceable infrastructure.

## Prerequisites

Before using the default Discord path:

- run `npm install`
- create `discord.routes.json` from `discord.routes.example.json`
- run `codex login` so `codex login status` reports ChatGPT login
- put Discord bot tokens in `.env`

Before using the legacy OpenClaw container commands:

- run `./scripts/instantiate-openclaw-teams.mjs`
- have Docker available locally

## Addressing Rules

Use these names consistently:

- Team ids:
  - `example-team-a`
  - `example-team-b`
- Agent ids:
  - `example-team-a-facilitator`
  - `example-team-a-architect`
  - `example-team-a-growth`
  - `example-team-b-facilitator`
  - `example-team-b-editor`
  - `example-team-b-maker`
- Container names:
  - `openclaw-<agent-id>`

## Why There Are No Dashboard Ports

Yes, that was intentional.

The current runtime model is:

- each agent lives in its own container
- each container owns its own isolated OpenClaw home
- the container stays alive with `sleep infinity`
- every turn is executed on demand with `docker exec ... openclaw agent --local --agent main ...`

That means there is **no long-lived per-agent gateway** bound to a host port, so there is nothing to expose as a dashboard URL right now.

This choice was deliberate because it matches your stated goal better:

- each container is its own `main`
- there is no ambiguous shared multi-agent home
- orchestration happens above the instances, not inside a single OpenClaw runtime

If you later want dashboards or remote control UIs, we can add a second mode where selected containers run a persistent gateway and expose loopback-only ports.

## Theory Of Operation

The current project flow is:

1. keep the team repo files as the source of truth for persona, memory, and behavioral contracts
2. use `teamctl` or the Discord broker to resolve the target team and agent
3. choose a provider, with `codex-acp` as the default Discord turn backend
4. generate the visible response through the provider
5. post that response through the matching Discord bot identity

For the legacy OpenClaw path, the controller still shells out into per-agent containers. For the current Discord path, the controller talks to Codex ACP directly and leaves OpenClaw out of the hot path.

## Discord Facilitation

Discord should be treated as a multi-bot meeting surface in front of the selected provider, not as six directly self-orchestrating agent containers.

Recommended model:

- one controller process
- one Discord bot identity per visible team member
- one or more Discord channels mapped to team ids
- one ingress bot per discussion channel, usually the facilitator
- controller invokes the selected provider and loads persona/memory files from the team repos
- controller posts each turn through the correct bot identity

See:

- `DISCORD.md`
- `discord.routes.example.json`

Run and validate it with:

```bash
./scripts/teamctl discord-init
./scripts/teamctl discord-validate
./scripts/teamctl discord-provider-doctor
./scripts/teamctl discord-run
```

The Discord commands use `TEAM_AGENT_PROVIDER=codex-acp` by default and do not require OpenClaw containers. Use `TEAM_AGENT_PROVIDER=openclaw` only when you intentionally want to compare against the legacy helper path.

## Preferred Operator Surface

Use one command:

```bash
cd /workspace/agent-team-tools
./scripts/teamctl <command> ...
```

## Core Commands

Initialize or refresh generated runtime:

```bash
./scripts/teamctl init
```

Start all containers:

```bash
./scripts/teamctl up
```

Stop all containers:

```bash
./scripts/teamctl down
```

Show container health:

```bash
./scripts/teamctl status
```

List teams and members:

```bash
./scripts/teamctl list
```

Ask one instance directly:

```bash
./scripts/teamctl ask example-team-a-facilitator "What are you watching?"
```

Run a team discussion round:

```bash
./scripts/teamctl room example-team-a "What is the next best launch move this week?"
```

Run a team heartbeat:

```bash
./scripts/teamctl heartbeat example-team-b
```

Tail one container's logs:

```bash
./scripts/teamctl logs example-team-b-editor
```

Open a shell in one container:

```bash
./scripts/teamctl shell example-team-a-growth
```

Show just one team's container status:

```bash
./scripts/teamctl ps example-team-a
```

Show the runtime state path for one agent:

```bash
./scripts/teamctl path example-team-b-maker
```

Explain dashboard availability:

```bash
./scripts/teamctl dashboard example-team-a-facilitator
```

Validate Discord routing config:

```bash
./scripts/teamctl discord-validate
```

Run the Discord broker:

```bash
export DISCORD_BOT_TOKEN=...
./scripts/teamctl discord-run
```

## Repo Responsibilities

Team repos are the source of truth for persona and workspace content:

- `/workspace/agent-team-a`
- `/workspace/agent-team-b`

Tools repo owns generation and operations:

- `/workspace/agent-team-tools`

Generated runtime lives in:

- `<team-repo>/runtime/<agent-id>/state`
- `/workspace/agent-team-tools/runtime/docker-compose.generated.yml`
- `/workspace/agent-team-tools/runtime/team-index.json`

## Recommended Daily Usage

Bring the system up:

```bash
./scripts/teamctl up
```

Check health:

```bash
./scripts/teamctl status
```

Talk to a team:

```bash
./scripts/teamctl room example-team-a "We need one concrete next move for this week."
./scripts/teamctl room example-team-b "We need one finished asset this week."
```

Use direct asks when you want a single voice:

```bash
./scripts/teamctl ask example-team-b-editor "What should we reject first?"
```
