# @stigmer/marketing

Remotion workspace for Stigmer marketing films. The first film is **Intro to Stigmer** (`films/intro/`), produced under stigmer-cloud project `20260902.01.stigmer-intro-video`.

## Model

A film is a manifest (`films/<film>/manifest.json`) plus scene components (`src/films/<film>/`). The manifest is the single source of truth: narration text, scene order, voice, and shot plans live there, and both the narration pipeline and the composition read it, so audio and picture cannot drift.

Generated and captured media is **never committed** (see `.gitignore`): the repo carries code and manifests, and every asset is re-derivable:

- **Narration** — `npm run narrate` regenerates `assets/narration/` from the manifest via ElevenLabs (millisecond-exact durations, cached by text+voice hash). Key: `planton secret get elevenlabs-api-key --ignore-env -o json`.
- **Presenter clips** — HeyGen lip-synced avatar clips driven by the narration MP3s; generation is scripted per film (see the project's records for the casting decisions).
- **Screen recordings** — `npm run capture` drives the live local console with Playwright (`films/intro/capture/`, one drive per shot id) against the demo world seeded by `npm run demo:seed` (`films/intro/demo/`, see its README). `npm run capture:transcript` captures the real `stigmer apply` output for the rendered terminal scene and stages the agent YAML for the code panel.

The composition always renders: scenes without assets show a structured placeholder, so a rough cut of the full film is available at every stage of production.

## Commands

```bash
npm run studio      # Remotion studio (interactive preview)
npm run narrate     # (re)generate narration audio from the manifest
npm run render      # render films/intro to out/intro-to-stigmer.mp4
npm run typecheck
```
