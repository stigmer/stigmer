import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { navigateToAgents, clickResourceCard } from "../../helpers/library";

/**
 * Library zone mount-contract and duplicate DOM id / radio-name audit
 * (stigmer/stigmer#593, #621).
 *
 * The library zone bypasses Next.js routing for detail navigation
 * (static-export constraint): `LibraryNavigationProvider` initializes
 * `activeDetail` from `window.location.pathname` and `LibraryLayout`
 * renders the detail as an overlay. The route-rendered children are
 * handled two ways, and each has its own pin here:
 *
 * - DIRECT load of a detail URL: the route children ARE the detail page,
 *   so LibraryLayout unmounts them entirely (oss#621) — the page renders
 *   exactly once. Before that fix both copies mounted (one hidden +
 *   aria-hidden), duplicating every unconditionally-rendered DOM id and
 *   resolving label/aria-labelledby lookups into the hidden copy (#593's
 *   symptom).
 *
 * - SOFT navigation from a list page: the hidden list copy stays mounted
 *   BY DESIGN (list scroll/filter state survives under the overlay).
 *   Hidden list + visible detail is the surviving double-mount shape, so
 *   the id/radio audits run against it: any SDK component that hardcodes
 *   a DOM id or radio-group `name` and renders on both surfaces would
 *   merge the copies (useId() is the fix pattern — oss#571/#593/#619).
 */

/** Ids page-wide that appear more than once (always invalid HTML). */
async function findDuplicateIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const counts = new Map<string, number>();
    for (const el of Array.from(document.querySelectorAll("[id]"))) {
      counts.set(el.id, (counts.get(el.id) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([id, n]) => `${id} x${n}`);
  });
}

/**
 * Radio-group names whose inputs span BOTH an aria-hidden subtree and the
 * visible page — i.e. two component instances merged into one keyboard
 * group. (A name shared within one copy is a legitimate group.)
 */
async function findLeakedRadioGroups(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const groups = new Map<string, { hidden: number; visible: number }>();
    for (const el of Array.from(
      document.querySelectorAll<HTMLInputElement>('input[type="radio"][name]'),
    )) {
      const g = groups.get(el.name) ?? { hidden: 0, visible: 0 };
      if (el.closest('[aria-hidden="true"]')) g.hidden += 1;
      else g.visible += 1;
      groups.set(el.name, g);
    }
    return [...groups.entries()]
      .filter(([, g]) => g.hidden > 0 && g.visible > 0)
      .map(([name]) => name);
  });
}

async function auditIdsAndRadios(page: Page) {
  const duplicateIds = await findDuplicateIds(page);
  expect(duplicateIds, `duplicate DOM ids: ${duplicateIds.join(", ")}`).toEqual(
    [],
  );

  const leakedGroups = await findLeakedRadioGroups(page);
  expect(
    leakedGroups,
    `radio groups spanning hidden+visible copies: ${leakedGroups.join(", ")}`,
  ).toEqual([]);
}

/**
 * Pins the oss#621 single-mount contract on a directly-loaded detail URL:
 * the route copy yields to the overlay (useRouteDetailYieldsToOverlay),
 * so the route-children slot renders EMPTY and the detail heading exists
 * exactly ONCE. Counted with CSS selectors — unlike role locators they
 * see through aria-hidden, so a regression back to a hidden second copy
 * cannot hide from this count.
 */
async function assertSingleMountedDetail(page: Page, headingText: string) {
  const diagnostics = await page.evaluate((text) => {
    const slot = document.querySelector('[data-slot="library-route-children"]');
    return {
      routeChildrenElementCount: slot?.childElementCount ?? 0,
      headingCopies: Array.from(document.querySelectorAll("h1, h2")).filter(
        (h) => (h.textContent ?? "").includes(text),
      ).length,
    };
  }, headingText);
  expect(
    diagnostics.routeChildrenElementCount,
    "route copy rendered content on a direct detail load — the oss#621 yield regressed",
  ).toBe(0);
  expect(
    diagnostics.headingCopies,
    `expected the detail heading exactly once (route copy yields, oss#621); got ${diagnostics.headingCopies}`,
  ).toBe(1);
}

test.describe("Library detail pages carry no duplicate DOM ids", () => {
  test("direct load renders the agent detail exactly once — no hidden route copy", async ({
    page,
    testAgent,
  }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);

    await expect(
      page.getByRole("heading", { name: testAgent.slug }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await assertSingleMountedDetail(page, testAgent.slug);
    await auditIdsAndRadios(page);
  });

  test("direct load renders the workflow detail exactly once — no hidden route copy", async ({
    page,
    testWorkflow,
  }) => {
    await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);

    await expect(
      page.getByRole("heading", { name: testWorkflow.slug }).first(),
    ).toBeVisible({ timeout: 15_000 });

    await assertSingleMountedDetail(page, testWorkflow.slug);
    await auditIdsAndRadios(page);
  });

  test("soft navigation keeps the hidden list copy without id or radio leaks", async ({
    page,
    testAgent,
  }) => {
    await navigateToAgents(page);
    await clickResourceCard(page, testAgent.slug);

    await expect(
      page.getByRole("heading", { name: testAgent.slug }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Arming check: the hidden list copy must actually be there — a
    // passing audit against a single-mounted page proves nothing. The
    // route-children slot identifies the list copy structurally (its
    // text content is not reliable evidence: virtualized card grids may
    // render nothing at display:none).
    const armed = await page.evaluate(() => {
      const slot = document.querySelector(
        '[data-slot="library-route-children"]',
      );
      return {
        slotPresent: slot !== null,
        slotHidden: slot?.getAttribute("aria-hidden") === "true",
      };
    });
    expect(
      armed.slotPresent && armed.slotHidden,
      `hidden list copy not armed under the overlay — the audit has no double-mount to check (${JSON.stringify(armed)})`,
    ).toBe(true);

    await auditIdsAndRadios(page);
  });
});
