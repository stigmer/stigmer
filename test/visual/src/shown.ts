// The pictures the site and the docs show: gallery scenes drawn sharp enough
// for a retina screen, approved in review like every other screenshot.
//
// An entry names a scene of the catalogue (catalog.ts), the CSS size it is
// drawn at, and optionally the rectangle inside it to keep, for a picture
// of one card rather than a whole screen. The suite's `shown` project draws
// each one at `SHOWN_SCALE` device pixels per CSS pixel and compares it with
// tests/__shown__/<name>.png; the site's build converts those files into the
// sizes it serves (site/scripts/generate-screens.ts), and `<Screen name>`
// embeds one by its name.
//
// An entry may also mark parts of its screen a page points at (the hero's
// pins), keyed by the claim each one labels (brand/agent-gets.ts's ids).
// A mark names its target as plain data, a role and an exact accessible
// name, and declares the box the target is drawn in, measured from the
// drawn screen as a clip is. The suite finds each target and fails when it
// is gone or its box moved, so a pin cannot drift off what it says.
//
// It imports nothing, not even the catalogue's types: the site reads this
// file into its own build and typecheck, where the kit's sources do not
// load. `src/__tests__/shown.test.ts` holds every entry to the catalogue.

/** Device pixels per CSS pixel in a shown picture: the 1x and 2x files the site serves both come from it. */
export const SHOWN_SCALE = 2;

/** The colour mode every shown picture is drawn in: the site is dark only. */
export const SHOWN_MODE = "dark";

/** A size in CSS pixels. */
export interface ShownSize {
  readonly width: number;
  readonly height: number;
}

/** A rectangle in CSS pixels, from the top left of the drawn viewport. */
export interface ShownClip extends ShownSize {
  readonly x: number;
  readonly y: number;
}

/** The roles a mark's target may have: the ones the marked screens use. */
export type ShownMarkRole = "button" | "link" | "row" | "cell";

/** A part of the drawn screen a page points at. */
export interface ShownMark {
  /** The target's role. */
  readonly role: ShownMarkRole;
  /** The target's accessible name, matched exactly, so "Approve" never finds "Approve all ledger tools". */
  readonly name: string;
  /** Where the target is drawn, in whole CSS pixels from the top left of the viewport. */
  readonly box: ShownClip;
}

/** One picture the site may show. */
export interface Shown {
  /** The handle pages use (`<Screen name="approval">`), kept apart from the scene so a scene can be swapped under it. */
  readonly name: string;
  /** The catalogue's scene it draws. */
  readonly scene: string;
  /** What the picture shows, as a reviewer would say it. */
  readonly title: string;
  /** The CSS size the scene is drawn at. */
  readonly viewport: ShownSize;
  /** The part of the viewport kept, when the picture is one card rather than the whole screen. */
  readonly clip?: ShownClip;
  /** Parts of the screen a page points at, by the id of the claim each labels (brand/agent-gets.ts). */
  readonly marks?: Readonly<Record<string, ShownMark>>;
}

/** Every picture the site may show. */
export const SHOWN: readonly Shown[] = [
  {
    name: "approval",
    scene: "session-approval",
    title: "A tool call waits for approval, in the console's session view",
    viewport: { width: 1280, height: 800 },
  },
  {
    name: "asks-first",
    scene: "story-asks-first",
    title:
      "Northwind's ledger agent asks before it posts an adjustment, as the customer sees it",
    viewport: { width: 1280, height: 800 },
    // The agent's reason and the approval card, measured from the drawn
    // screen: the card spans x 288 to 992 and y 300 to 541, the reason sits
    // above it from y 201, and the turn's status bar starts at y 559.
    clip: { x: 272, y: 186, width: 736, height: 366 },
  },
  {
    name: "in-product",
    scene: "story-in-product",
    title:
      "Stigmer's chat panel docked beside a product's ledger screen for Northwind Books, its agent asking before it posts an adjustment",
    // Tall enough that the panel holds the whole conversation, from the
    // person's message to the composer, without scrolling.
    viewport: { width: 1280, height: 1000 },
    // The product's window, measured from the drawn screen: its ring at
    // x 23 and 1256, y 23 and 976; the page's margin around it is left off,
    // so the picture sits on the site's own ground.
    clip: { x: 23, y: 23, width: 1234, height: 954 },
    marks: {
      "own-computer": { role: "button", name: "Read 1 file 1 s", box: { x: 899, y: 262, width: 325, height: 32 } },
      "asks-first": { role: "button", name: "Approve", box: { x: 923, y: 647, width: 74, height: 30 } },
      walls: { role: "button", name: "Northwind Books", box: { x: 40, y: 34, width: 181, height: 32 } },
    },
  },
  {
    name: "in-product-panel",
    scene: "story-in-product",
    title: "Stigmer's chat panel inside a product, its agent asking before it posts an adjustment to Northwind's ledger",
    viewport: { width: 1280, height: 1000 },
    // The panel's column, measured from the drawn screen: its left border
    // at x 866, the window's ring at x 1256 and at y 23 and 976.
    clip: { x: 866, y: 23, width: 391, height: 954 },
  },
];

/** The CSS size of one shown picture: its clip, or the whole viewport. */
export function shownSize(shown: Shown): ShownSize {
  const { width, height } = shown.clip ?? shown.viewport;
  return { width, height };
}
