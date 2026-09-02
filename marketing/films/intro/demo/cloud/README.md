# Cloud demo world (Meridian on Stigmer Cloud)

**No film shot records against cloud anymore** — the v2 gate (2026-09-02) moved the scene-4 payoff beat to the React app in `../app/` against the local stack, after the cloud guest path refused the live question (billing preflight: the prod org holds no credits). This folder remains the reproducible cloud twin of the Meridian world: org, MCP manifest, skill, agent, and the public-audience share variant — useful for embed-element demos (`../embed/`), which ride the guest path and are cloud-only on OSS.

This folder is that shot's reproducible setup, mirroring `../seed.mjs` for the cloud minimal set: org, MCP server manifest, skill, agent, and the public-audience share variant (`traveler-assist-share.yaml` here; the committed local share is org-audience by design). The workflow and its daily schedule are deliberately excluded — a live schedule on a real backend would keep firing after the camera stops.

## Reseeding the cloud world

1. `stigmer auth login` (the seed refuses to run unless the CLI backend is cloud).
2. `npm run demo:seed:cloud` (from `marketing/`).
3. For the embed-element page against cloud: `APP_ORIGIN=https://app.stigmer.ai npm run demo:embed`.

Note: a live guest question on cloud needs the org funded (the billing preflight refuses guests otherwise — `add-org-credits` in stigmer-cloud's rules is the top-up path).
