# Management Model

This toolset uses a simple mental model:

- **Team**: a discussion group like `example-team-a` or `example-team-b`
- **Agent**: one isolated OpenClaw home/container like `example-team-a-facilitator`
- **Runtime**: generated state plus Docker containers

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

## Discord Facilitation

Discord should be treated as a multi-bot meeting surface in front of the team runtime, not as six directly self-orchestrating agent containers.

Recommended model:

- one controller process
- one Discord bot identity per visible team member
- one or more Discord channels mapped to team ids
- one ingress bot per discussion channel, usually the facilitator
- controller invokes the Discord-aware room/direct helpers
- controller posts each turn through the correct bot identity

See:

- `DISCORD.md`
- `discord.routes.example.json`

Run and validate it with:

```bash
./scripts/teamctl discord-init
./scripts/teamctl discord-validate
./scripts/teamctl discord-run
```

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
