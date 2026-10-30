/**
 * The header and footer menus link only to paths the site serves.
 *
 * The menus are read from their constants, not from a rendered page: the
 * Resources menu draws its items only while it is open, and no page test
 * reads a link it cannot see. Without this, deleting a route and forgetting
 * its menu entry would leave every test green and every visitor one click
 * from a page that no longer exists.
 */
import { describe, expect, it } from "vitest";
import { FOOTER_LINKS, NAV_LINKS_ALL } from "@/lib/constants";
import { servedPath } from "@/__test-utils__/site-paths";

const MENUS: ReadonlyArray<readonly [string, ReadonlyArray<{ href: string }>]> = [
  ["the header", NAV_LINKS_ALL],
  ...Object.entries(FOOTER_LINKS).map(
    ([column, items]) => [`the footer's ${column} column`, items] as const,
  ),
];

describe("site navigation", () => {
  it("sends every internal link in the header and footer to a path the site serves", () => {
    const internal = MENUS.flatMap(([menu, items]) =>
      items.map((item) => [menu, item.href] as const).filter(([, href]) => href.startsWith("/")),
    );

    expect(internal.length).toBeGreaterThan(0);
    for (const [menu, href] of internal) {
      expect(servedPath(href), `${href} in ${menu} is not served`).toBe(true);
    }
  });
});
