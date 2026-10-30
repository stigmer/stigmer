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
 */
import { SHOWN, SHOWN_SCALE, shownSize, type Shown } from "../../../test/visual/src/shown";

export { SHOWN, SHOWN_SCALE, shownSize, type Shown };

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
