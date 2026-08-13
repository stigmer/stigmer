import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";

/**
 * Duplicate DOM id / radio-name audit on library detail pages
 * (stigmer/stigmer#593).
 *
 * The library zone bypasses Next.js routing for detail navigation
 * (static-export constraint): `LibraryNavigationProvider` initializes
 * `activeDetail` from `window.location.pathname`, and `LibraryLayout`
 * renders that overlay copy while ALSO keeping the route-rendered copy
 * mounted (hidden + aria-hidden). On a DIRECT load of a detail URL both
 * copies are the same detail page — so any SDK component that hardcodes a
 * DOM id and renders it unconditionally duplicates that id, and
 * document-order id lookup resolves label/aria-labelledby associations
 * into the HIDDEN copy: screen readers land on aria-hidden nodes and
 * getByLabel locators match nothing. A hardcoded radio-group `name` is the
 * same defect with sharper teeth: radios in both copies join ONE keyboard
 * group. (Click-through navigation arms only the overlay over the hidden
 * LIST page, so the deep-link/reload path is the one that must be audited.)
 *
 * The fix (oss#593, following the oss#571 precedent) is instance-scoped
 * ids/names minted with useId(). These specs pin that invariant on the two
 * double-mounted surfaces that carry always-rendered dialog forms; the
 * page-wide audit also catches any future component that regresses into
 * hardcoded ids on these pages.
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
 * Radio-group names whose inputs span BOTH the aria-hidden route copy and
 * the visible overlay copy — i.e. two component instances merged into one
 * keyboard group. (A name shared within one copy is a legitimate group.)
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

/**
 * Asserts the double-mount is actually armed before auditing — a passing
 * audit on a single-mounted page would prove nothing. Armed means the
 * page heading exists TWICE: once in the hidden route copy, once in the
 * visible overlay (CSS locators, unlike role locators, see through
 * aria-hidden).
 */
async function auditDoubleMountedPage(page: Page, headingText: string) {
  const diagnostics = await page.evaluate((text) => {
    const headings = Array.from(document.querySelectorAll("h1, h2")).filter(
      (h) => (h.textContent ?? "").includes(text),
    );
    const hiddenWrapper = document.querySelector('div.hidden[aria-hidden="true"]');
    return {
      headingCopies: headings.length,
      hiddenWrapperPresent: hiddenWrapper !== null,
      hiddenWrapperChildCount: hiddenWrapper?.childElementCount ?? 0,
    };
  }, headingText);
  expect(
    diagnostics.headingCopies,
    `double-mount not armed: expected the detail heading in both the hidden route copy and the visible overlay (diagnostics: ${JSON.stringify(diagnostics)})`,
  ).toBeGreaterThanOrEqual(2);

  const duplicateIds = await findDuplicateIds(page);
  expect(duplicateIds, `duplicate DOM ids: ${duplicateIds.join(", ")}`).toEqual([]);

  const leakedGroups = await findLeakedRadioGroups(page);
  expect(
    leakedGroups,
    `radio groups spanning hidden+visible copies: ${leakedGroups.join(", ")}`,
  ).toEqual([]);
}

test.describe("Library detail pages carry no duplicate DOM ids", () => {
  test("agent detail page (direct load arms overlay + hidden route copy)", async ({
    page,
    testAgent,
  }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);

    await expect(
      page.getByRole("heading", { name: testAgent.slug }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // CreateAgentInstanceDialog renders its form unconditionally (closed
    // <dialog> still in the DOM), so before the useId fix this audit fails
    // with the agent-instance name/description ids duplicated across the
    // hidden and visible copies.
    await auditDoubleMountedPage(page, testAgent.slug);
  });

  test("workflow detail page (direct load arms overlay + hidden route copy)", async ({
    page,
    testWorkflow,
  }) => {
    await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);

    await expect(
      page.getByRole("heading", { name: testWorkflow.slug }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Guards the CreateWorkflowInstanceDialog useId fix (oss#571) and any
    // future hardcoded-id regression on this surface.
    await auditDoubleMountedPage(page, testWorkflow.slug);
  });
});
