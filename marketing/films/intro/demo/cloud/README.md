# Cloud demo world (Meridian on Stigmer Cloud)

**No film shot records against cloud anymore** — the scene-4 payoff beat is the React app in `../app/` against the local stack, so the film needs no hosted account. This folder remains the reproducible cloud twin of the Meridian world: org, skill, agent, and the public-audience share variant — useful for embed-element demos (`../embed/`), which ride the guest path and are cloud-only on OSS.

This folder is that shot's reproducible setup, mirroring `../seed.mjs` for the cloud minimal set: org, skill, agent, and the public-audience share variant (`traveler-assist-share.yaml` here; the committed local share is org-audience by design). The daily digest schedule is deliberately excluded — a live schedule on a real backend would keep firing after the camera stops.

The meridian-ops plugin is excluded too. Its MCP server is a local program (stdio), which runs only in the desktop app or the CLI, and a conversation hosted in a cloud sandbox is refused at session create when a plugin it lists has one; the share's guests are hosted there. So `seed-cloud.mjs` applies `../resources/traveler-assist.yaml` rendered without its `plugins` block and without the fare-search sub-agent's tool list (which names only that plugin's search tool). The embed shot never exercises tools, so nothing on screen changes.

## Reseeding the cloud world

1. `stigmer auth login` (the seed refuses to run unless the CLI backend is cloud).
2. `npm run demo:seed:cloud` (from `marketing/`).
3. For the embed-element page against cloud: `APP_ORIGIN=https://app.stigmer.ai npm run demo:embed`.

Note: a live guest question on cloud needs the org funded (the billing preflight refuses guests otherwise — `add-org-credits` in stigmer-cloud's rules is the top-up path).
