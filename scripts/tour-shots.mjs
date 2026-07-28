/**
 * Shot discovery for Scenar tours — the one place that defines how a tour's
 * timeline and its declared `shot` names are found.
 *
 * Two consumers with a hard consistency requirement share it:
 * `scripts/verify-scenar-tours.mjs` (the CI gate — invariant 8 resolves every
 * docs `<Still>` id against these names) and `demos/scripts/pack-all.mjs`
 * (the deploy pipeline — it runs `scenar shoot` for exactly the tours that
 * declare a shot). If the two ever disagreed about what a tour declares, CI
 * could pass while the deploy ships a page whose still 404s, or the deploy
 * could launch browsers for tours nothing references.
 *
 * Discovery is runtime truth, not source-text approximation: callers import
 * the tour's steps.ts (under the tsx loader, exactly how `scenar narrate`
 * and the packed entry load it) and hand the module here. An AST scan would
 * miss a shot name built from a constant and silently diverge from what
 * `scenar shoot` sees in the running bundle.
 *
 * The packed bundle's scenario.json does NOT carry this information — it
 * records the viewport (scenar DD-004) but not the shots, so every consumer
 * must come back to the TypeScript source. Recording shots in the bundle
 * descriptor (and letting `scenar shoot` skip the browser launch for
 * shot-less bundles) is engine work tracked on stigmer/scenar: `scenar pack`
 * never imports the steps module in-process today, and making it do so
 * changes which steps.ts files pack at all — a contract decision that
 * belongs to the engine, not to a consumer-side workaround.
 */

/**
 * Find the timeline in a `steps.ts` module the same way `scenar pack` and
 * `scenar narrate` do: the first exported array whose first element carries
 * a `delayMs` key. Returns null when no export matches.
 */
export function findStepsArray(mod) {
  for (const val of Object.values(mod)) {
    if (
      Array.isArray(val) &&
      val.length > 0 &&
      typeof val[0] === "object" &&
      val[0] !== null &&
      "delayMs" in val[0]
    ) {
      return val;
    }
  }
  return null;
}

/**
 * The shot names a tour's timeline declares, in step order. Name validity
 * (kebab-case, uniqueness) is the engine's contract, enforced when the
 * bundle is packed and shot; callers here only need membership and count.
 */
export function collectShotNames(steps) {
  return steps
    .filter((step) => typeof step?.shot === "string" && step.shot.length > 0)
    .map((step) => step.shot);
}
