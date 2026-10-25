# @stigmer/marketing

Remotion workspace for Stigmer marketing films:

- **Intro to Stigmer** (`films/intro/`, `src/films/intro/`), narrated, with a presenter and console recordings.
- **The job film** (`src/films/job/`), 25 seconds and silent: the homepage hero's picture of a customer's agent at work, played once, opening on the headline and ending on the one sentence. Its story, lighting and words come from `brand/job-story.ts`, `brand/agent-gets.ts` and `brand/positioning.ts`, the files the site reads, and `src/films/job/__tests__/job-film.test.ts` (run by the root `npm run test:marketing`, part of `test:root`) holds it to them. It renders in two cuts: `JobFilm` (1920 × 1080) and `JobFilmSquare` (1080 × 1080, no word under 28px, for phone feeds). The renders are uploads: after a change to those files, render both again and replace the posted copies.

## Model

The intro film is a manifest (`films/<film>/manifest.json`) plus scene components (`src/films/<film>/`). The manifest is the single source of truth: narration text, scene order, voice, and shot plans live there, and both the narration pipeline and the composition read it, so audio and picture cannot drift.

Generated and captured media is **never committed** (see `.gitignore`): the repo carries code and manifests, and every asset is re-derivable:

- **Narration** — `npm run narrate` regenerates `assets/narration/` from the manifest via ElevenLabs (millisecond-exact durations, cached by text+voice hash). Key: `planton secret get elevenlabs-api-key --ignore-env -o json`.
- **Presenter clips** — HeyGen lip-synced avatar clips driven by the narration MP3s; generation is scripted per film.
- **Music bed** — `npm run music -- --yes` generates `assets/music/bed.mp3` from the manifest's `music` block via ElevenLabs Music (cached by prompt hash; paid API, so the flag is required). The composition mounts the bed only when the file exists.
- **Screen recordings** — `npm run capture` drives the live local console with Playwright (`films/intro/capture/`, one drive per shot id) against the demo world seeded by `npm run demo:seed` (`films/intro/demo/`, see its README). The on-camera arrow cursor is drawn by the harness itself (`capture/lib/cursor.mjs` + `human.mjs` — driven positioning, so it survives iframe boundaries like the embed widget). `npm run capture:transcript` captures the real `stigmer apply` output for the rendered terminal scene and stages the agent YAML for the code panel.

The composition always renders: scenes without assets show a structured placeholder, so a rough cut of the full film is available at every stage of production.

## Commands

```bash
npm run studio      # Remotion studio (interactive preview)
npm run narrate     # (re)generate narration audio from the manifest
npm run music       # (re)generate the music bed from the manifest (--yes: paid)
npm run render      # render films/intro to out/intro-to-stigmer.mp4
npm run render:job         # render the job film to out/job-film.mp4 (1920 × 1080, silent)
npm run render:job-square  # render its square cut to out/job-film-square.mp4 (1080 × 1080, silent)
npm run typecheck
```
