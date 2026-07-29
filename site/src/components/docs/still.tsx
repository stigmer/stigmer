import { ImageZoom } from "fumadocs-ui/components/image-zoom";
import { parseStillId, stillImageUrl } from "@/lib/demos-base";

/**
 * Rendered pixel size of every still: the tours' canonical 1280x800 viewport
 * (pinned for all tours in demos/scripts/pack-all.mjs) captured at DPR 2 by
 * `scenar shoot`. The stage backdrop consumes — never adds to — the shell
 * height, so this holds at any camera position. Explicit dimensions give the
 * browser the aspect ratio up front: no layout shift while the image loads
 * (`output: "export"` means there is no Next image optimizer to do it for us).
 */
const STILL_WIDTH = 2560;
const STILL_HEIGHT = 1600;

interface StillProps {
  /**
   * `"<scenario>/<shot>"` — the tour directory under `demos/tours/` and a
   * `shot` name declared on one of its steps. CI resolves both halves
   * (`scripts/verify-scenar-tours.mjs` invariant 8), so a typo fails the
   * build instead of shipping a broken image.
   */
  id: string;
  /**
   * Screen description for readers who get text instead of pixels — it lands
   * verbatim in llms-full.txt, the per-page .md export, and Copy-as-Markdown.
   * Describe the screen, don't repeat the narration (DD-02: two texts).
   * Required here and enforced in CI, since MDX is never typechecked.
   */
  alt: string;
}

/**
 * A Scenar-rendered screenshot in the docs prose — the `still` and
 * `screenshot-journey` medium (docs/STYLE.md).
 *
 * Renders the light capture only: the docs site is dark-only, and media is
 * deliberately light-on-dark — a bright frame that reads as content against
 * the dark page (the Cursor-docs convention). This also matches the markdown
 * exports, where `llms-pages.ts` has always linked the light variant.
 * (`scenar shoot` still produces a dark capture per shot; it is unused here —
 * tracked in the docs-revamp debt register.)
 *
 * Composes the registered `<ImageZoom>` (click-to-zoom at the full
 * 2560x1600 capture).
 */
export function Still({ id, alt }: StillProps) {
  const ref = parseStillId(id);
  if (!ref) {
    throw new Error(
      `<Still id="${id}">: id must be "<scenario>/<shot>" — the tour directory ` +
        `under demos/tours/ and a shot name declared in its steps.ts ` +
        `(e.g. "agent-detail-tour/agent-detail").`,
    );
  }

  return (
    <div className="not-prose mx-auto my-4 w-full max-w-4xl">
      <ImageZoom
        src={stillImageUrl(ref, "light")}
        alt={alt}
        width={STILL_WIDTH}
        height={STILL_HEIGHT}
        loading="lazy"
        className="rounded-lg"
      />
    </div>
  );
}
