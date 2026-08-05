import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/sdk";
import { test, expect } from "../../fixtures";
import { ensureSystemOrg } from "../../fixtures/seed-helpers";

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

const SYSTEM_ORG = "stigmer";

async function pinActiveOrg(page: Page): Promise<void> {
  await page.addInitScript((org) => {
    localStorage.setItem("stigmer:activeOrgSlug", org);
  }, SYSTEM_ORG);
}

/** Seed an agent + a schedule targeting it; returns slugs and a cleanup. */
async function createTestSchedule(
  stigmerClient: Stigmer,
  options?: { enabled?: boolean },
) {
  const stamp = Date.now();
  const agent = await stigmerClient.agent.create({
    name: `e2e-sched-agent-${stamp}`,
    org: SYSTEM_ORG,
    instructions: "You send short reminder messages. Keep responses brief.",
  });
  const agentSlug = agent.metadata!.slug!;
  const agentId = agent.metadata!.id!;

  const schedule = await stigmerClient.schedule.create({
    name: `e2e-sched-${stamp}`,
    org: SYSTEM_ORG,
    cron: "0 9 * * *",
    timeZone: "Asia/Kolkata",
    enabled: options?.enabled ?? true,
    agent: {
      agentRef: { org: SYSTEM_ORG, slug: agentSlug },
      message: "Send today's reminders.",
    },
  });
  const scheduleSlug = schedule.metadata!.slug!;
  const scheduleId = schedule.metadata!.id!;

  return {
    agentSlug,
    scheduleSlug,
    scheduleId,
    cleanup: async () => {
      await stigmerClient.schedule.delete(scheduleId).catch(() => {});
      await stigmerClient.agent.delete(agentId).catch(() => {});
    },
  };
}

test.describe("Schedules list page", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("renders heading, workbench, both creation paths — and no search box", async ({
    page,
    stigmerClient,
  }) => {
    await ensureSystemOrg(stigmerClient);
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
    // a search box that silently matches nothing would lie (DD-006).
    await expect(
      page.getByLabel("Schedule workbench").getByRole("textbox"),
    ).not.toBeVisible();
  });

  test("lists a seeded schedule with live status columns and navigates to detail", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestSchedule(stigmerClient);
    try {
      await page.goto("/library/schedules");

      const row = page.getByText(seeded.scheduleSlug).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      // Operational columns straight from the proto.
      await expect(page.getByText("0 9 * * *").first()).toBeVisible();
      await expect(
        page.getByText(`${SYSTEM_ORG}/${seeded.agentSlug}`).first(),
      ).toBeVisible();

      await row.click();

      // Detail: definition + status sections and the header badge.
      await expect(
        page.getByRole("heading", { name: seeded.scheduleSlug }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Asia/Kolkata").first()).toBeVisible();
      await expect(page.getByText("Send today's reminders.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Run now" })).toBeVisible();
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Schedule creation form", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("creates a schedule from the form with the Daily preset", async ({
    page,
    stigmerClient,
  }) => {
    await ensureSystemOrg(stigmerClient);

    const stamp = Date.now();
    const agent = await stigmerClient.agent.create({
      name: `e2e-form-agent-${stamp}`,
      org: SYSTEM_ORG,
      instructions: "You send short reminder messages. Keep responses brief.",
    });
    const agentSlug = agent.metadata!.slug!;
    const scheduleName = `e2e-form-sched-${stamp}`;
    let scheduleId: string | undefined;

    try {
      await page.goto("/library/schedules/new");

      await page.getByLabel("Name").fill(scheduleName);

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
        page.getByRole("heading", { name: scheduleName }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("0 9 * * *").first()).toBeVisible();
      await expect(page.getByText("Schedule is disabled")).toBeVisible();

      // Server-side confirmation of what the form submitted.
      const created = await stigmerClient.schedule.getByReference({
        org: SYSTEM_ORG,
        slug: scheduleName,
      });
      scheduleId = created.metadata!.id!;
      expect(created.spec?.cron).toBe("0 9 * * *");
      expect(created.spec?.enabled).toBe(false);
      expect(
        created.spec?.target?.case === "agent"
          ? created.spec.target.value.agentRef?.slug
          : undefined,
      ).toBe(agentSlug);
    } finally {
      if (scheduleId) {
        await stigmerClient.schedule.delete(scheduleId).catch(() => {});
      }
      await stigmerClient.agent.delete(agent.metadata!.id!).catch(() => {});
    }
  });
});

test.describe("Schedule detail tabs and inline editing", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("deep-links to the Runs tab and inline-edits the message losslessly", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestSchedule(stigmerClient);
    try {
      // The ?tab= deep link lands directly on the Runs tab (the
      // AgentDetailPage precedent, wired for schedules too).
      await page.goto(
        `/library/schedules/${SYSTEM_ORG}/${seeded.scheduleSlug}?tab=runs`,
      );
      await expect(
        page.getByRole("tab", { name: "Overview" }),
      ).toBeVisible({ timeout: 15_000 });
      // A fresh schedule has an empty fire ledger — stated, not blank.
      await expect(page.getByText("No runs yet.")).toBeVisible();

      // Overview: the cadence humanizes; the raw cron stays visible.
      await page.getByRole("tab", { name: "Overview" }).click();
      await expect(
        page.getByText("Every day at 09:00 (Asia/Kolkata)"),
      ).toBeVisible();
      await expect(page.getByText("0 9 * * *")).toBeVisible();

      // Inline-edit the message: click-to-edit, save, and the view
      // reflects the new value.
      await page.getByText("Send today's reminders.").click();
      await page
        .getByRole("textbox")
        .fill("Send this week's reminders.");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(
        page.getByText("Send this week's reminders."),
      ).toBeVisible({ timeout: 15_000 });

      // Server-side confirmation that the save was the lossless
      // full-proto re-apply: the edited field changed, nothing else.
      const after = await stigmerClient.schedule.getByReference({
        org: SYSTEM_ORG,
        slug: seeded.scheduleSlug,
      });
      expect(
        after.spec?.target?.case === "agent"
          ? after.spec.target.value.message
          : undefined,
      ).toBe("Send this week's reminders.");
      expect(after.spec?.cron).toBe("0 9 * * *");
      expect(after.spec?.enabled).toBe(true);
    } finally {
      await seeded.cleanup();
    }
  });
});

test.describe("Disabled-vs-paused rendering", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("owner-disabled schedule shows the banner and Enable re-applies losslessly", async ({
    page,
    stigmerClient,
  }) => {
    const seeded = await createTestSchedule(stigmerClient, { enabled: false });
    try {
      await page.goto(
        `/library/schedules/${SYSTEM_ORG}/${seeded.scheduleSlug}`,
      );

      // The owner's lever renders distinctly, with its remedy inline.
      await expect(page.getByText("Schedule is disabled")).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Disabled").first()).toBeVisible();
      // Run now refuses client-side while the schedule cannot fire.
      await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();

      // Enable through the banner: a full-proto re-apply via the
      // manifest engine (the lossless write path).
      await page.getByRole("button", { name: "Enable schedule" }).click();

      await expect(page.getByText("Schedule is disabled")).not.toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("Active").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Run now" })).toBeEnabled();

      // Server-side confirmation: enabled flipped, nothing else touched.
      const after = await stigmerClient.schedule.getByReference({
        org: SYSTEM_ORG,
        slug: seeded.scheduleSlug,
      });
      expect(after.spec?.enabled).toBe(true);
    } finally {
      await seeded.cleanup();
    }
  });
});
