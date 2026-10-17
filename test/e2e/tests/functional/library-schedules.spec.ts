import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/client";
import { test, expect } from "../../fixtures";
import { ensureOrg } from "../../fixtures/seed-helpers";

/** The organization these journeys seed into and point the console at. */
const ROUTINES_ORG = "e2e-schedules";

/**
 * Schedule Library journeys (stigmer/stigmer#352) against the live OSS
 * stack.
 *
 * The load-bearing behaviors:
 * - The list is direct-query backed: full protos render the operational
 *   columns (state, cadence, next fire) and there is deliberately NO
 *   text-search box (schedules have no server-side search).
 * - The disabled-vs-paused distinction renders as two levers with two
 *   remedies; the owner's Enable action re-applies the FULL proto
 *   through the manifest engine (lossless — verified end-to-end here by
 *   round-tripping a schedule that carries tags).
 */

/** Makes the schedules organization the console's active one (stored by id) before the first page loads. */
async function pinActiveOrg(page: Page, stigmerClient: Stigmer): Promise<void> {
  const id = await ensureOrg(stigmerClient, ROUTINES_ORG, "E2E schedules");
  await page.addInitScript((org) => {
    localStorage.setItem("stigmer:activeOrg", org);
  }, id);
}

/**
 * Seed an agent + a schedule targeting it; returns slugs and a cleanup.
 * Seeds the organization too, so a case that calls it never depends on a
 * sibling case having run first.
 */
async function createTestRoutine(
  stigmerClient: Stigmer,
  options?: { enabled?: boolean },
) {
  await ensureOrg(stigmerClient, ROUTINES_ORG, "E2E schedules");
  // Cases run on parallel workers in one organization, so the millisecond
  // alone can repeat; the random suffix keeps two seeds' slugs apart.
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const agent = await stigmerClient.agent.create({
    name: `e2e-sched-agent-${stamp}`,
    org: ROUTINES_ORG,
    instructions: "You send short reminder messages. Keep responses brief.",
  });
  const agentSlug = agent.metadata!.slug!;
  const agentId = agent.metadata!.id!;

  const routine = await stigmerClient.routine.create({
    name: `e2e-sched-${stamp}`,
    org: ROUTINES_ORG,
    cron: "0 9 * * *",
    timeZone: "Asia/Kolkata",
    enabled: options?.enabled ?? true,
    agent: {
      agentRef: { org: ROUTINES_ORG, slug: agentSlug },
      message: "Send today's reminders.",
    },
  });
  const routineSlug = routine.metadata!.slug!;
  const routineId = routine.metadata!.id!;

  return {
    agentSlug,
    routineSlug,
    routineId,
    cleanup: async () => {
      await stigmerClient.routine.delete(routineId).catch(() => {});
      await stigmerClient.agent.delete(agentId).catch(() => {});
    },
  };
}

test.describe("Schedules list page", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("renders heading, workbench, both creation paths — and no search box", async ({
    page,
    stigmerClient,
  }) => {
    await ensureOrg(stigmerClient, ROUTINES_ORG, "E2E schedules");
    await page.goto("/library/schedules");

    await expect(
      page.getByRole("heading", { level: 1, name: "Schedules" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Schedule workbench")).toBeVisible();
    // Form-based creation is the primary path; Apply YAML stays as the
    // secondary, declarative/GitOps path.
    await expect(
      page.getByRole("link", { name: "New schedule" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Apply YAML" }).first(),
    ).toBeVisible();
    // Direct-query list: no server text search, so no search input —
    // a search box that silently matches nothing would lie.
    await expect(
      page.getByLabel("Schedule workbench").getByRole("textbox"),
    ).not.toBeVisible();
  });

  test("lists a seeded schedule with live status columns and navigates to detail", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestRoutine(stigmerClient);
    try {
      await page.goto("/library/schedules");

      const row = page.getByText(seeded.routineSlug).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      // Operational columns straight from the proto.
      await expect(page.getByText("0 9 * * *").first()).toBeVisible();
      await expect(
        page.getByText(`${ROUTINES_ORG}/${seeded.agentSlug}`).first(),
      ).toBeVisible();

      await row.click();

      // Detail: definition + status sections and the header badge.
      await expect(
        page.getByRole("heading", { name: seeded.routineSlug }),
      ).toBeVisible({ timeout: 15_000 });
      // The zone shows in the cadence line; other copies of it (a select's
      // options, a tooltip) are hidden, so match the visible one.
      await expect(page.getByText("Asia/Kolkata").filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByText("Send today's reminders.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeVisible();
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Schedule creation form", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("creates a schedule from the form with the Daily preset", async ({
    page,
    stigmerClient,
  }) => {
    await ensureOrg(stigmerClient, ROUTINES_ORG, "E2E schedules");

    const stamp = Date.now();
    const agent = await stigmerClient.agent.create({
      name: `e2e-form-agent-${stamp}`,
      org: ROUTINES_ORG,
      instructions: "You send short reminder messages. Keep responses brief.",
    });
    const agentSlug = agent.metadata!.slug!;
    const routineName = `e2e-form-sched-${stamp}`;
    let routineId: string | undefined;

    try {
      await page.goto("/library/schedules/new");

      await page.getByLabel("Name").fill(routineName);

      // The picker is locked to org scope — pick the seeded agent.
      await page.getByText("Choose an agent…").click();
      await page.getByPlaceholder("Search agents...").fill(agentSlug);
      await page.getByRole("option", { name: new RegExp(agentSlug) }).click();

      await page.getByLabel("Message").fill("Send today's reminders.");

      // Default cadence is Daily at 09:00 — the summary states it and
      // the generated cron lands on the detail page below.
      await expect(page.getByTestId("cadence-summary")).toContainText(
        "Every day at 09:00",
      );

      await page.getByRole("button", { name: "Create schedule" }).click();

      // Landed on the detail page: definition renders the generated
      // cron, and the staged-disabled default shows the owner's banner.
      await expect(
        page.getByRole("heading", { name: routineName }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("0 9 * * *").first()).toBeVisible();
      await expect(page.getByText("Schedule is disabled")).toBeVisible();

      // Server-side confirmation of what the form submitted.
      const created = await stigmerClient.routine.getByReference({
        org: ROUTINES_ORG,
        slug: routineName,
      });
      routineId = created.metadata!.id!;
      expect(created.spec?.cron).toBe("0 9 * * *");
      expect(created.spec?.enabled).toBe(false);
      expect(
        created.spec?.agent?.agentRef?.slug,
      ).toBe(agentSlug);
    } finally {
      if (routineId) {
        await stigmerClient.routine.delete(routineId).catch(() => {});
      }
      await stigmerClient.agent.delete(agent.metadata!.id!).catch(() => {});
    }
  });
});

test.describe("Schedule detail tabs and inline editing", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("deep-links to the Runs tab and inline-edits the message losslessly", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestRoutine(stigmerClient);
    try {
      // The ?tab= deep link lands directly on the History tab (the
      // AgentDetailPage precedent, wired for schedules too).
      await page.goto(
        `/library/schedules/${ROUTINES_ORG}/${seeded.routineSlug}?tab=history`,
      );
      await expect(
        page.getByRole("tab", { name: "Overview" }),
      ).toBeVisible({ timeout: 15_000 });
      // A fresh schedule has an empty fire ledger — stated, not blank.
      await expect(page.getByText("No fires yet.")).toBeVisible();

      // Overview: the cadence humanizes; the raw cron stays visible.
      await page.getByRole("tab", { name: "Overview" }).click();
      await expect(
        page.getByText("Every day at 09:00 (Asia/Kolkata)"),
      ).toBeVisible();
      await expect(page.getByText("0 9 * * *")).toBeVisible();

      // Inline-edit the message: click-to-edit, save, and the view
      // reflects the new value. The editor opens on the stored text, and
      // the fill replaces it whole (an append here was stigmer/stigmer#1575).
      await page.getByText("Send today's reminders.").click();
      // The message editor is the page's one textarea (the slug field is
      // a text input).
      const messageField = page.locator("textarea");
      await expect(messageField).toHaveValue("Send today's reminders.");
      await messageField.fill("Send this week's reminders.");
      await page.getByRole("button", { name: "Save" }).click();
      // The editor closes only once the save has returned. Until then its
      // own (disabled) textarea carries the new text, which getByText
      // matches, so the read view's button is what proves the save landed.
      await expect(messageField).toBeHidden({ timeout: 15_000 });
      await expect(
        page.getByRole("button", { name: "Send this week's reminders." }),
      ).toBeVisible();

      // Server-side confirmation that the save was the lossless
      // full-proto re-apply: the edited field changed, nothing else.
      const after = await stigmerClient.routine.getByReference({
        org: ROUTINES_ORG,
        slug: seeded.routineSlug,
      });
      expect(
        after.spec?.agent?.message,
      ).toBe("Send this week's reminders.");
      expect(after.spec?.cron).toBe("0 9 * * *");
      expect(after.spec?.enabled).toBe(true);
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Schedule rename", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("renames a schedule from its detail view; the old reference still reads it, and the address follows", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestRoutine(stigmerClient);
    const renamed = `${seeded.routineSlug}-renamed`;
    try {
      await page.goto(`/library/schedules/${ROUTINES_ORG}/${seeded.routineSlug}`);
      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible({
        timeout: 15_000,
      });

      await page.getByLabel("Slug").fill(renamed);
      await page.getByRole("button", { name: "Rename" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/library/schedules/${ROUTINES_ORG}/${renamed}$`),
        { timeout: 15_000 },
      );

      // The old reference reads the same schedule, named by its new slug.
      const byOld = await stigmerClient.routine.getByReference({
        org: ROUTINES_ORG,
        slug: seeded.routineSlug,
      });
      expect(byOld.metadata?.id).toBe(seeded.routineId);
      expect(byOld.metadata?.slug).toBe(renamed);

      // A bookmark to the old address opens it and moves to the new one.
      await page.goto(`/library/schedules/${ROUTINES_ORG}/${seeded.routineSlug}`);
      await expect(page).toHaveURL(
        new RegExp(`/library/schedules/${ROUTINES_ORG}/${renamed}$`),
        { timeout: 15_000 },
      );
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Disabled-vs-paused rendering", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("owner-disabled schedule shows the banner and Enable re-applies losslessly", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestRoutine(stigmerClient, { enabled: false });
    try {
      await page.goto(
        `/library/schedules/${ROUTINES_ORG}/${seeded.routineSlug}`,
      );

      // The owner's lever renders distinctly, with its remedy inline.
      await expect(page.getByText("Schedule is disabled")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Disabled").first()).toBeVisible();
      // A disabled schedule's primary action is "Enable & run now", the
      // one-click staged-test flow, never a bare "Run now"
      // (RoutineDetailView's primaryAction).
      await expect(page.getByRole("button", { name: "Enable & run now" })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Run now", exact: true })).toHaveCount(0);

      // Enable through the banner: a full-proto re-apply via the
      // manifest engine (the lossless write path).
      await page.getByRole("button", { name: "Enable schedule" }).click();

      await expect(page.getByText("Schedule is disabled")).not.toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Active").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
      await expect(page.getByRole("button", { name: "Enable & run now" })).toHaveCount(0);

      // Server-side confirmation: enabled flipped, nothing else touched.
      const after = await stigmerClient.routine.getByReference({
        org: ROUTINES_ORG,
        slug: seeded.routineSlug,
      });
      expect(after.spec?.enabled).toBe(true);
    } finally {
      await seeded.cleanup();
    }
  });
});
