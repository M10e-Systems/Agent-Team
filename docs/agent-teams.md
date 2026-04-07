# Agent Teams

## What Is An Agent Team?

An agent team is a small group of specialist agent identities organized around one user goal or project.

The point is not to make one assistant pretend to have multiple voices. The point is to give each role a stable identity, a clear job, and a shared operating contract so the group can reason together in a disciplined way.

## What The Team Is About

Agent teams are about visible collaboration.

Each team member can focus on a different lens:

- facilitation
- critique
- synthesis
- operations
- writing
- growth
- research

That lets the team behave more like a working group than a single chat model that changes tone on demand.

## What Team Members Share

Team members can share:

- a team registry entry
- a shared discussion contract
- project materials from the team repo
- channel or room context when the controller passes it in
- optional shared memory files that belong to the team

What they share should be intentional. The team repo is the place to define the durable shared material, not the ad hoc chat thread.

## What Team Members Do Not Share

By default, team members do not share:

- private session state
- hidden chain-of-thought
- another member's local turn history unless the controller explicitly includes it
- authorization to act outward on their own

That separation keeps roles distinct and reduces noisy cross-talk.

## How A Turn Moves Through The Team

At a high level:

1. A user sends a prompt to a team surface.
2. The controller maps the prompt to a team and a target role.
3. The controller loads the relevant identity and memory material from the team repo.
4. The selected provider produces one visible reply or a small round of replies.
5. The controller posts the result back through the chosen surface.

Direct addressing can require a response. Untagged room prompts can allow silence when a role has nothing useful to add.

## What Differentiates This Approach

Agent teams differ from a single assistant because they preserve role boundaries instead of collapsing everything into one generic voice.

They differ from one monolithic multi-agent runtime because the team identity lives outside the runtime. The repo defines the team, and the runtime is only the execution layer.

This makes the system:

- easier to reason about
- easier to swap providers underneath
- easier to keep stable over time
- easier to expose through multiple surfaces

## When To Use A Team Instead Of One Assistant

Use a team when the work benefits from multiple stable perspectives at once.

Good fits include:

- project planning with distinct strategic and execution concerns
- creative work with editor, maker, and critic roles
- operator workflows where one voice should watch risk while another pushes progress
- community or Discord rooms where visible specialist identities matter

Use one assistant when you just need a fast, single-threaded answer and role separation would add noise.

## Current Implementation Boundaries

This repository currently supports a provider-backed Discord/operator path and a legacy OpenClaw-backed fallback path.

The current live surface prefers `codex-acp`. OpenClaw remains available for comparison and legacy commands, but it is not the product identity.
