/**
 * API key setup tour — the step-level embed on the Quickstart's "Sign up
 * and get your API key" step. Five beats on the console's API Keys page:
 * a fresh account with no keys, the cursor finding "+ New API key", the
 * create form, the form filled in, and the one-time reveal.
 *
 * The tour opens directly on the API Keys page: the docs prose above the
 * embed already gives the route ("Settings → API Keys"), so the legacy
 * inline demo's four user-menu navigation beats are deliberately not
 * depicted (decided 2026-07-26 — no user-menu chrome exists in demos/ and
 * none was worth building for a route the prose covers).
 *
 * The key being created is `QUICKSTART_API_KEY` — the same depicted
 * resource whose reveal quickstart-tour's beat 0 shows at the top of the
 * page. One identity in `_shared/`, so the name typed in the form here,
 * the key revealed at the end, and the page-level tour's alert cannot
 * drift apart.
 *
 * Import discipline: `scenar narrate` loads this file in plain Node (tsx),
 * so it must only pull pure modules — type-only `@scenar/react` imports,
 * `_shared` data, and literals. Component rendering lives in `index.tsx`.
 */
import type { ScenarioStep } from "@scenar/react";
import { QUICKSTART_API_KEY } from "../_shared/quickstart-workspace";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

/** The surface shown at a given step (maps to a branch in `renderStep`). */
export type ApiKeySetupStep =
  | { view: "keys-idle" }
  | { view: "create-form"; name?: string }
  | { view: "key-created" };

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/*
 * Step 0 is interaction-free (the packed embed arms step-0 interactions at
 * mount, under the poster); the cursor beat is step 1, which re-renders the
 * same idle view and clears the cursor before the form appears.
 */
export const apiKeySetupSteps: ScenarioStep<ApiKeySetupStep>[] = [
  {
    delayMs: 0,
    data: { view: "keys-idle" },
    narration:
      "You need an API key to call Stigmer from code. In the console, open Settings, then API Keys — a fresh account has no keys yet.",
  },
  {
    delayMs: 2500,
    data: { view: "keys-idle" },
    narration: "Click New API key to create one.",
    interactions: [
      { atPercent: 0.3, type: "set_cursor", target: "create-api-key" },
      { atPercent: 0.92, type: "clear_cursor" },
    ],
  },
  {
    delayMs: 3000,
    data: { view: "create-form" },
    narration:
      "Give the key a name that says where it will be used, and pick an expiry — Never is fine for the quickstart.",
  },
  {
    delayMs: 3500,
    data: { view: "create-form", name: QUICKSTART_API_KEY.name },
    narration: "Call it quickstart-key, and create the key.",
  },
  {
    delayMs: 3000,
    data: { view: "key-created" },
    narration:
      "Your key is ready. Copy it now — you won't see the full key again after this.",
    // The revealed key is the beat's payoff and renders at text-sm — the
    // camera leans in while the narration says "copy it now", then pulls
    // back before the beat ends (the create-agent-tour legibility pattern;
    // demos/README.md "Legibility comes from the camera").
    interactions: [
      { type: "viewport_transition", target: "key-reveal", viewportZoom: 1.5, atPercent: 0.25 },
      { type: "viewport_transition", viewportReset: true, atPercent: 0.85 },
    ],
  },
];
