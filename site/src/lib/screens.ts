/**
 * The screens the site and the docs show, by name, and the one place each
 * screen's file name and address are made.
 *
 * The list is the visual suite's (test/visual/src/shown.ts): a screen is a
 * gallery scene the suite draws at `SHOWN_SCALE` and approves in review, so
 * it cannot go stale the way a captured screenshot does. The build converts
 * each approved picture into one WebP file per density under
 * `public/screens` (scripts/generate-screens.ts), `<Screen>` embeds them,
 * and the markdown exports link the sharpest one in the tag's place
 * (`cleanContent` in ./llms-pages.ts). All three name the files through
 * this module, so they cannot disagree on one.
 *
 * A picture's marks (the parts a page points a pin at) come from the same
 * list, where the suite checks each against the drawing; `placedMarks`
 * places them on the picture or on a crop of the same drawing.
 */
import { AGENT_GET_ORDER, type AgentGetId } from "../../../brand/agent-gets";
import { SHOWN, SHOWN_SCALE, shownSize, type Shown, type ShownMark } from "../../../test/visual/src/shown";

export { SHOWN, SHOWN_SCALE, shownSize, type Shown, type ShownMark };

/** The folder under `public/` the converted screens are written to, and the path they are served from. */
export const SCREENS_DIR = "screens";

/** The pixel densities each screen is served in: one CSS pixel each, and the density the suite draws at. */
export const SCREEN_DENSITIES = [1, SHOWN_SCALE] as const;

/** The shown picture `name` names; a name the list does not hold fails the build that asked for it. */
export function shownScreen(name: string): Shown {
  const shown = SHOWN.find((entry) => entry.name === name);
  if (!shown) {
    const known = SHOWN.map((entry) => `"${entry.name}"`).join(", ");
    throw new Error(`no screen named "${name}"; the visual suite shows ${known} (test/visual/src/shown.ts)`);
  }
  return shown;
}

/** The file one screen is served from at one density: `approval-2x.webp`. */
export function screenFile(name: string, density: number): string {
  return `${name}-${density}x.webp`;
}

/** The site-relative address of one screen at one density: `/screens/approval-2x.webp`. */
export function screenPath(name: string, density: number): string {
  return `/${SCREENS_DIR}/${screenFile(name, density)}`;
}

/** One screen's files at every density, as a `srcset` of widths. */
export function screenSrcSet(name: string): string {
  const { width } = shownSize(shownScreen(name));
  return SCREEN_DENSITIES.map((density) => `${screenPath(name, density)} ${width * density}w`).join(", ");
}

/** A mark placed on a picture: the claim it labels and its box, in percent of the picture. */
export interface PlacedMark {
  readonly id: AgentGetId;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The marks of the picture `source`, placed on the picture `on`: the same
 * picture, or another crop of the same drawing. A mark that does not lie
 * wholly inside `on` is left off, so a pin never points past the picture's
 * edge. In the brand's order, so the pins number the claims as every list
 * of them does.
 */
export function placedMarks(source: string, on: string = source): PlacedMark[] {
  const from = shownScreen(source);
  const to = shownScreen(on);
  if (from.scene !== to.scene || from.viewport.width !== to.viewport.width || from.viewport.height !== to.viewport.height) {
    throw new Error(`"${on}" is not a crop of the drawing "${source}" marks`);
  }
  const crop = to.clip ?? { x: 0, y: 0, ...to.viewport };
  const marks: Readonly<Record<string, ShownMark>> = from.marks ?? {};
  return AGENT_GET_ORDER.flatMap((id) => {
    const mark = marks[id];
    if (mark === undefined) return [];
    const { x, y, width, height } = mark.box;
    if (x < crop.x || y < crop.y || x + width > crop.x + crop.width || y + height > crop.y + crop.height) return [];
    return [
      {
        id,
        left: ((x - crop.x) / crop.width) * 100,
        top: ((y - crop.y) / crop.height) * 100,
        width: (width / crop.width) * 100,
        height: (height / crop.height) * 100,
      },
    ];
  });
}
