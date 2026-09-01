# S4d cloud preconditions

One shot in the film records against Stigmer Cloud: **S4d**, the Meridian page with the live `<stigmer-agent>` widget. The framed embed rides the guest path (public-audience share RPCs), which the OSS local stack doesn't serve — everything else in the film shoots local, per the recording-environment ruling in the project's design decisions.

This folder is that shot's reproducible setup, mirroring `../seed.mjs` for the cloud minimal set: org, MCP server manifest, skill, agent, and the public-audience share variant (`traveler-assist-share.yaml` here; the committed local share is org-audience by design). The workflow and its daily schedule are deliberately excluded — a live schedule on a real backend would keep firing after the camera stops.

## Shooting S4d

1. `stigmer auth login` (the seed refuses to run unless the CLI backend is cloud).
2. `npm run demo:seed:cloud` (from `marketing/`).
3. `APP_ORIGIN=https://app.stigmer.ai npm run demo:embed` — serves the Meridian page with the widget pointed at cloud.
4. `S4D_PAGE_URL=http://localhost:4173 npm run capture -- s4d-embed`.

The take lands at `assets/recordings/s4d-embed.webm`; the film manifest's `s4d-embed` cut plays it.
