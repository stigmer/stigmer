# Meridian Travel — the Intro to Stigmer demo world

Everything the film shows on screen is real product state, authored here and applied to a live local stack. This directory rebuilds that world from scratch on any machine — the recordings are repo-reproducible.

## What's here

| Path | What it is | Where it appears |
|---|---|---|
| `mcp/meridian-ops.mjs` | Real stdio MCP server (flight search + rebooking), deterministic outputs | S3d config shot; powers the S4b approval gate |
| `mcp/smoke.mjs` | Stdio round-trip test of the server (`npm run demo:smoke`) | — |
| `skills/rebooking-policy/` | The versioned policy skill, pushed with tag `stable` | S3c skill shot |
| `resources/traveler-assist.yaml` | The hero agent YAML, written in narration order | S3b editor walk |
| `resources/meridian-ops.yaml` | McpServer manifest with the pinned approval on `rebook_booking` | S3d |
| `resources/disruption-digest.yaml` | Workflow with a real `budget` block | S5a canvas, S5b budget |
| `resources/disruption-digest-schedule.yaml` | Daily 6:00 schedule (agent target — see note inside) | S5c |
| `resources/organization.yaml` | The `meridian-travel` org | throughout |
| `embed/` | The Meridian product page carrying `<stigmer-agent>` + its static server | S4d |
| `cloud/` | The S4d cloud preconditions: minimal seed + public-audience share (see its README) | S4d |
| `seed.mjs` | Applies all of the above, idempotently (`npm run demo:seed`) | — |

## Rebuilding the world

1. Bring up a local stack: `stigmer up` (with `ANTHROPIC_API_KEY` in the environment).
2. `npm run demo:seed` (from `marketing/`; set `STIGMER_BIN` if the CLI isn't on PATH).
3. For the embed shot: `npm run demo:embed`, then open http://localhost:4173.
4. For the share-link shot: `stigmer share agent meridian-travel/traveler-assist --audience public`.

The chat scene's booking is `MT-4821` (Priya Shah, SFO→JFK on flight MT-214, flex fare). "Move my flight to tomorrow morning" lands on MT-102 at 07:05 — a $42 fare difference, no change fee — and `rebook_booking` stops for approval with the booking and flight in the dialog message.

## Determinism contract

The MCP server derives every answer from its fixture tables and the tool arguments — never the clock, never randomness — so a re-shot take produces the same screens. The fixtures implement `rebooking-policy/SKILL.md` exactly (fare classes, fees, disruption rules); if you change one, change both, and update `mcp/smoke.mjs` which pins the arithmetic.
