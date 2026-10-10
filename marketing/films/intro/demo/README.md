# Meridian Travel — the Intro to Stigmer demo world

Everything the film shows on screen is real product state, authored here and applied to a live local stack. This directory rebuilds that world from scratch on any machine — the recordings are repo-reproducible.

## What's here

| Path | What it is | Where it appears |
|---|---|---|
| `mcp/meridian-ops.mjs` | Real stdio MCP server (flight search + rebooking), deterministic outputs; marks `rebook_booking` destructive (`destructiveHint: true`), so a turn asks before it runs | S3d config shot; powers the S4b approval gate |
| `mcp/smoke.mjs` | Stdio round-trip test of the server (`npm run demo:smoke`) | — |
| `skills/rebooking-policy/` | The versioned policy skill, pushed with tag `stable` | S3c skill shot |
| `resources/traveler-assist.yaml` | The hero agent YAML, written in narration order | S3b editor walk |
| `plugins/meridian-ops/` | The one-server plugin that installs `mcp/meridian-ops.mjs` (`.claude-plugin/plugin.json` + `.mcp.json`); `seed.mjs` renders the `__MERIDIAN_DEMO_DIR__` placeholder to this checkout's path and pushes the rendered copy | S3d |
| `resources/disruption-digest-schedule.yaml` | Daily 6:00 schedule firing the hero agent with the digest prompt | S5c |
| `resources/organization.yaml` | The `meridian-travel` org | throughout |
| `embed/` | The Meridian product page carrying `<stigmer-agent>` + its static server | S4d |
| `cloud/` | The S4d cloud preconditions: minimal seed + public-audience share (see its README) | S4d |
| `seed.mjs` | Applies and pushes all of the above, idempotently (`npm run demo:seed`) | — |

## Rebuilding the world

1. Bring up a local stack: `stigmer up` (with `ANTHROPIC_API_KEY` in the environment).
2. `npm run demo:seed` (from `marketing/`; set `STIGMER_BIN` if the CLI isn't on PATH).
3. For the embed shot: `npm run demo:embed`, then open http://localhost:4173.
4. For the share-link shot: `stigmer share agent meridian-travel/traveler-assist --audience public`.

The chat scene's booking is `MT-4821` (Priya Shah, SFO→JFK on flight MT-214, flex fare). "Move my flight to tomorrow morning" lands on MT-102 at 07:05 — a $42 fare difference, no change fee — and `rebook_booking` stops for approval with the booking and flight in the dialog message.

## The plugin's server path

A plugin's MCP server cannot name a working directory, and the server script imports the MCP SDK from `marketing/node_modules`, so it has to run where it lives rather than from a copy inside the plugin archive. The committed `.mcp.json` therefore passes the script's absolute path as the argument, written as `__MERIDIAN_DEMO_DIR__/mcp/meridian-ops.mjs`; `seed.mjs` substitutes this checkout's path into a temp copy and runs `stigmer --org meridian-travel push plugin` on it. Pushing unchanged content again reports `unchanged`. The agent lists the plugin in `spec.plugins`, and its tools are named `mcp__plugin_meridian-ops_meridian-ops__<tool>`.

The server is a local program (stdio), so the plugin runs on the local stack, the desktop app and the CLI only: a conversation hosted in a cloud sandbox is refused when a plugin it lists has one. The cloud seed (`cloud/`) leaves the plugin out for that reason.

## Determinism contract

The MCP server derives every answer from its fixture tables and the tool arguments — never the clock, never randomness — so a re-shot take produces the same screens. The fixtures implement `rebooking-policy/SKILL.md` exactly (fare classes, fees, disruption rules); if you change one, change both, and update `mcp/smoke.mjs` which pins the arithmetic.
