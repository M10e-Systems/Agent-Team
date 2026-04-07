# Agent Team Tools

Tools for building and operating provider-backed agent teams. An agent team is a small group of specialist identities that share a team repo, a discussion contract, and a coordinated surface such as Discord, while keeping their roles and visible voices distinct.

## What This Is

This repository is the operator and integration layer for agent teams.

It helps you:

- define team membership and routing
- run team discussions through a chosen provider
- expose those teams on Discord or other surfaces
- keep team identity and memory in the team repos instead of in one hidden runtime home

## Why Agent Teams

Agent teams work well when one assistant voice is not enough, but you still want clear boundaries.

They give you:

- stable specialist voices
- shared team context
- role-specific memory and prompt material
- visible collaboration instead of one monolithic assistant pretending to be many roles
- provider-swappable execution so the team model can outlive any one backend

## How It Works

The team repos define identity, memory, and shared contracts.

This tools repo:

- reads the registry in `teams.json`
- generates or resolves runtime state when needed
- routes turns through the selected provider
- surfaces the team through Discord or direct local commands

Discord is one surface for operating agent teams, not the definition of the teams themselves.

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Prepare a team registry in `teams.json`.

3. Generate the runtime index and other derived files:

   ```bash
   ./scripts/teamctl init
   ```

4. Create local Discord routing from the public example:

   ```bash
   ./scripts/teamctl discord-init
   ```

5. Validate the routing and provider setup:

   ```bash
   ./scripts/teamctl discord-validate
   ./scripts/teamctl discord-provider-doctor
   ```

6. Run a local broker test:

   ```bash
   ./scripts/teamctl discord-inject example-team-a "We need one concrete next move this week."
   ```

7. Start the Discord broker:

   ```bash
   ./scripts/teamctl discord-run
   ```

## Documentation Map

- [Agent teams concept](docs/agent-teams.md)
- [Build and operate guide](docs/build-and-operate.md)
- [Productivity field guide](docs/productivity-field-guide.md)
- [Reference](docs/reference.md)

## Legacy Note

Some script names, runtime paths, and fallback provider helpers still contain `OpenClaw` because the repository started there. That name now describes legacy implementation details, not the product identity.
