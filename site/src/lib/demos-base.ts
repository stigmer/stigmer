/**
 * The hosted-demos contract: where the packed Scenar bundles (and the stills
 * captured from them) live, and how a still's URL is derived.
 *
 * Tours are authored in this repo's `demos/` workspace and packed + deployed
 * by the website release workflow, so the artifacts ship atomically with the
 * docs pages that reference them. Three consumers derive URLs from this one
 * module — `<ScenarEmbed>` (iframe embeds), `<Still>` (captured images), and
 * the markdown exporter's still unwrap — so the URL shape cannot drift
 * between the rendered site and the text channels.
 */

/** Production home of the packed tour bundles. */
const DEMOS_BASE_DEFAULT = "https://stigmer.ai/demos";

/**
 * Base URL of the hosted tour bundles.
 *
 * Defaults to production — absolute (not a relative `/demos`) so local docs
 * dev shows the released artifacts instead of 404ing against the dev server.
 * `NEXT_PUBLIC_SCENAR_EMBED_BASE` overrides it for the authoring loop: point
 * it at a local `scenar serve` origin to see an unreleased tour, still, or
 * engine version on its real docs page before it deploys. See
 * `demos/README.md` for the loop. Resolved per call, not at module scope:
 * Next.js inlines the env read at build time either way, and a runtime read
 * is what lets tests exercise the override.
 */
export function resolveDemosBase(): string {
  return process.env.NEXT_PUBLIC_SCENAR_EMBED_BASE ?? DEMOS_BASE_DEFAULT;
}

/** The two theme variants `scenar shoot` captures for every shot (DD-02 D2). */
export type StillTheme = "light" | "dark";

/** A parsed `<Still>` id: the scenario directory and the declared shot name. */
export interface StillRef {
  scenario: string;
  shot: string;
}

/**
 * Parse a `<Still id>` — `"<scenario>/<shot>"`, exactly one slash, both
 * segments non-empty. Returns null on any other shape so each caller can
 * apply its own failure policy: the `<Still>` component fails loudly (an
 * author is looking), while the markdown-export unwrap leaves malformed
 * tags untouched (a build is running, and a dangling tag in the export is
 * more diagnosable than a broken image URL).
 */
export function parseStillId(id: string): StillRef | null {
  const match = /^([^/]+)\/([^/]+)$/.exec(id);
  if (!match) return null;
  return { scenario: match[1], shot: match[2] };
}

/**
 * Public URL of one captured still. The path shape
 * (`<scenario>/stills/<shot>.<theme>.png`) is `scenar shoot`'s output
 * layout inside a packed bundle, which the deploy ships verbatim.
 */
export function stillImageUrl(ref: StillRef, theme: StillTheme): string {
  return `${resolveDemosBase()}/${ref.scenario}/stills/${ref.shot}.${theme}.png`;
}
