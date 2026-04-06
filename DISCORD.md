# Discord Multi-Bot Meeting Model

## Intent

This document describes the recommended way to run team discussions on Discord using one visible Discord bot identity per team member without weakening the current isolated-instance architecture.

## Key Decision

Do **not** let every isolated team container independently manage Discord orchestration.

Instead, use a **multi-bot meeting controller** that:

- logs in one Discord bot per team member
- maps each discussion channel to one team
- accepts inbound messages through one designated ingress bot per room
- invokes the existing team orchestration tooling
- posts each turn through the matching bot identity

This preserves the core design:

- one isolated OpenClaw home per agent
- one `main` per container
- orchestration outside the instances

## Why This Fits The Current Runtime

The current runtime intentionally does not run persistent gateways inside the six team containers.

That means:

- no per-agent Discord bot session is running
- no per-agent dashboard/gateway port is exposed
- no agent container is currently a live Discord ingress point

For Discord group discussions, the clean extension is a **single controller process** in front of many bot identities, not six unrelated Discord automation stacks.

## Mental Model

Think of Discord as a meeting room with assigned seats:

- Discord channel = discussion venue
- Team id = room behind that venue
- Multi-bot controller = moderator/router
- Discord bot identities = visible speakers in the room
- Team containers = isolated specialist brains behind the scenes

## Recommended Channel Model

Create one Discord text channel per discussion room.

Suggested pattern:

- `#example-team-a-launch-room`
- `#example-team-b-room`

Optional direct specialist channels:

- `#example-team-a-architect`
- `#example-team-b-editorial`

Recommended default:

- start with one channel per team
- add specialist channels only if you want persistent direct-access behavior

## Addressing Model On Discord

### Team-level addressing

Map a Discord channel directly to one team.

Examples:

- `#example-team-a-launch-room` -> `example-team-a`
- `#example-team-b-room` -> `example-team-b`

Messages in that channel are treated as meeting prompts.

### Specialist addressing inside a team channel

Because each team member has its own Discord bot identity, the preferred direct-address mechanism is a real bot mention in the channel.

Examples:

- mention the Harbor bot for `example-team-a-facilitator`
- mention the Flint bot for `example-team-a-architect`
- mention the Ash bot for `example-team-b-editor`

Optional textual aliases may still be supported as fallback:

- `@facilitator`
- `@architect`
- `@growth`
- `@editor`
- `@maker`

Recommended behavior:

- if no specialist mention is present, route as a normal team meeting round
- if one specialist bot is mentioned, route as a direct ask to that specialist instance and require that specialist to answer
- if `@everyone` or `@here` is used, require every team member in the mapped room to answer once

## Recommended Controller Behavior

For each routed Discord message:

1. identify the mapped team from the channel id
2. verify that the current bot is the designated ingress bot for that channel
3. inspect the message for a directly mentioned team-member bot
4. if a direct bot mention exists:
   - call the Discord direct-ask helper for that agent
4. otherwise:
   - call the Discord room helper for that team
5. post each resulting turn back into the same Discord channel using the matching bot client

Optional broker enhancements:

- create threads for each discussion round
- add natural pacing between turns
- show `is typing...` while a slow room turn is still processing
- ignore bot chatter and repeated low-value messages

## Recommended Runtime Shape

Add one additional runtime role outside the isolated team members:

- **Multi-bot meeting controller**

Responsibilities:

- holds one token per bot identity
- maintains the persistent Discord connections
- chooses one ingress bot per room
- reads channel messages through the ingress bot
- maps channel ids to teams
- invokes the tools repo orchestration commands
- posts each turn through the correct bot identity

Recommended first version:

- one controller process or container
- one Discord app/bot token per visible team member
- one Discord server
- one routing file in the tools repo

## Routing File

Suggested files:

- `discord.routes.example.json` as template
- `discord.routes.json` as local working file with real ids

Operator commands:

```bash
./scripts/teamctl discord-init
./scripts/teamctl discord-validate
DISCORD_BOT_TOKEN=... ./scripts/teamctl discord-run
./scripts/teamctl discord-inject example-team-a "We need one concrete next move this week."
```

Suggested fields:

- guild id
- bot identities and token env vars
- team-channel mappings
- ingress bot per channel
- optional specialist aliases
- response policy

Useful `responsePolicy` options:

- `reactWhileProcessing`: add a quick reaction as soon as ingress fires
- `typingWhileProcessing`: keep the ingress bot showing `is typing...` while the backend is working
- `typingRefreshMs`: refresh interval for Discord typing state
- `progressNotices`: send an explicit in-channel progress message while a round is still running
- `progressNoticeAfterMs`: delay before the first progress message appears
- `progressNoticeRepeatMs`: repeat interval for subsequent progress messages
- `processingTimeoutMs`: hard limit for a room round or direct ask before the broker fails gracefully
- `perTurnDelayMs`: pacing between streamed room turns
- `presence`: idle bot presence shown in the member list

Recommended hardening pattern:

- keep `typingWhileProcessing` enabled for slow turns
- keep `progressNotices` enabled if you want the channel to say out loud that work is still happening
- set `processingTimeoutMs` to a value that is long enough for normal work but short enough that Discord users do not stare at a silent channel forever
- treat timeout failures as a prompt to investigate backend latency, not as a reason to leave the controller hanging

## Local Injection Testing

When you want broker-path testing without writing into Discord directly, use:

```bash
./scripts/teamctl discord-inject <channel-id|team-id> <message...>
```

Examples:

```bash
./scripts/teamctl discord-inject example-team-a "We need one concrete next move this week."
./scripts/teamctl discord-inject 1486747252268466398 "@architect What risk are we underestimating?"
```

This uses the same route resolution and the same room/direct helper scripts as the broker, but prints the resulting turn stream locally instead of sending messages to Discord.

## Example Flow

User posts in `#example-team-a-launch-room`:

> We need one concrete next move this week.

Controller resolves:

- channel -> `example-team-a`
- ingress bot -> `example-team-a-facilitator`
- no specialist mention present

Controller executes:

```bash
node ./scripts/team-room-json.mjs example-team-a "We need one concrete next move this week."
```

Controller posts the resulting turns into the same Discord channel through Harbor, Flint, and Vale as needed.

If the user posts:

> @Flint What risk are we underestimating?

Controller resolves:

- channel -> `example-team-a`
- mentioned bot -> `example-team-a-architect`

Controller executes:

```bash
node ./scripts/team-discord-ask.mjs example-team-a-architect "What risk are we underestimating?"
```

## Response Style Recommendation

For Discord, prefer:

- one post per speaking bot
- no markdown tables
- channel-appropriate brevity
- natural meeting cadence

## Dashboard / Ports

There are still no dashboard ports in the default team runtime.

That remains intentional.

The multi-bot controller does not require exposing six dashboards.

If later desired, a separate gateway-backed mode can be added for the broker itself or for selected facilitator instances.

## First Practical Setup

What you already have:

- a Discord developer account
- one Discord server
- the current team tooling

What you need next:

1. create the Discord bot and get the token
2. repeat that for each visible team member bot you want
3. create one text channel per team discussion room
4. collect the server id and channel ids
5. create a local routing file from the template with `./scripts/teamctl discord-init`
6. fill in the real ids in `discord.routes.json`
7. export one token env var per bot
8. run `./scripts/teamctl discord-validate`
9. run `./scripts/teamctl discord-run`

## Current Status

Current state:

- documented
- architecturally aligned with the isolated-instance model
- implemented as a first-pass multi-bot meeting controller in `scripts/discord-broker.mjs`
- requires local config plus one token per bot before it can be used against a real server
