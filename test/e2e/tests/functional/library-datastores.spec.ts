import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  createTestDatastore,
  ensureSystemOrg,
  type TestDatastoreResult,
} from "../../fixtures/seed-helpers";

/**
 * Datastore records-UI journeys (DD-008) against the live OSS stack.
 *
 * The OSS record layer resolves datastores against the `stigmer` system
 * org only, so every fixture seeds there and each test pins the
 * console's active org to `stigmer` before first paint (the persisted
 * `stigmer:activeOrgSlug` the OrgProvider restores).
 *
 * Journeys (per the T06 plan):
 * - browse / filter / partition switch
 * - insert with constraint violation → the declared message, verbatim
 * - partial-merge edit + explicit-null clear
 * - denied-state render (deny-by-default: empty access lists)
 * - guarded delete (agent-reference block, then slug-typed count arming)
 */

const SYSTEM_ORG = "stigmer";

async function pinActiveOrg(page: Page): Promise<void> {
  await page.addInitScript((org) => {
    localStorage.setItem("stigmer:activeOrgSlug", org);
  }, SYSTEM_ORG);
}

async function openRecordsTab(page: Page, datastore: TestDatastoreResult): Promise<void> {
  await page.goto(`/library/datastores/${datastore.org}/${datastore.slug}`);
  await page.getByRole("tab", { name: "Records" }).click();
}

test.describe("Datastores list page", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("renders heading, workbench, and the Apply YAML entry point", async ({
    page,
    stigmerClient,
  }) => {
    await ensureSystemOrg(stigmerClient);
    await page.goto("/library/datastores");

    await expect(
      page.getByRole("heading", { level: 1, name: "Datastores" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Datastore workbench")).toBeVisible();
    // No creation wizard — datastores are declared in YAML (DD-008).
    await expect(
      page.getByRole("button", { name: "Apply YAML" }).first(),
    ).toBeVisible();
  });

  test("applies a datastore via YAML and it appears without a reload", async ({
    page,
    stigmerClient,
  }) => {
    await ensureSystemOrg(stigmerClient);
    const slug = `e2e-apply-refresh-${Date.now()}`;
    const manifest = [
      "apiVersion: agentic.stigmer.ai/v1",
      "kind: Datastore",
      "metadata:",
      `  name: ${slug}`,
      `  org: ${SYSTEM_ORG}`,
      "spec:",
      "  description: Apply-refresh e2e check.",
      "  collections:",
      "    - name: notes",
      "      fields:",
      "        - name: text",
      "          type: string",
      "          required: true",
      "      grants:",
      "        - role: reader",
      "          verbs: [read]",
      "  authorization:",
      "    roles:",
      "      - name: reader",
      "    default_role: reader",
      "",
    ].join("\n");

    try {
      await page.goto("/library/datastores");
      await expect(page.getByLabel("Datastore workbench")).toBeVisible({
        timeout: 15_000,
      });
      // The new datastore is not present before applying.
      await expect(page.getByText(slug)).not.toBeVisible();

      await page.getByRole("button", { name: "Apply YAML" }).first().click();
      // Upload path avoids CodeMirror keystroke plumbing; the dialog
      // validates the same way as a paste.
      await page
        .getByLabel("Select manifest file")
        .setInputFiles({
          name: `${slug}.yaml`,
          mimeType: "application/x-yaml",
          buffer: Buffer.from(manifest, "utf8"),
        });

      // Preview resolves, then Apply.
      const applyButton = page.getByRole("button", { name: /^Apply$/ });
      await expect(applyButton).toBeEnabled({ timeout: 15_000 });
      await applyButton.click();

      // The refresh signal (onApplied) re-reads the list in place — no
      // page.reload() — so the newly applied datastore appears on its own.
      await expect(page.getByText(slug).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      const existing = await stigmerClient.datastore
        .getByReference({ org: SYSTEM_ORG, slug })
        .catch(() => null);
      if (existing?.metadata?.id) {
        await stigmerClient.datastore
          .delete({ resourceId: existing.metadata.id, force: true })
          .catch(() => {});
      }
    }
  });

  test("lists a seeded datastore and navigates to its detail", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient);
    try {
      await page.goto("/library/datastores");
      await page.getByText(datastore.slug).first().click();

      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("tab", { name: "Records" })).toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });
});

test.describe("Records browser", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("browses records with typed cells and totals", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    try {
      await openRecordsTab(page, datastore);

      await expect(page.getByLabel("Records in bookings")).toBeVisible({
        timeout: 15_000,
      });
      // Canonical encodings render as stored: time canonicalized to HH:MM:SS.
      await expect(page.getByText("2026-08-03").first()).toBeVisible();
      await expect(page.getByText("09:00:00").first()).toBeVisible();
      // The default partition holds 3 of the 4 seeded records.
      await expect(page.getByText("3 records")).toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });

  test("filters server-side through the draft-then-apply builder", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    try {
      await openRecordsTab(page, datastore);
      await expect(page.getByLabel("Records in bookings")).toBeVisible({
        timeout: 15_000,
      });

      await page.getByRole("button", { name: "Add filter" }).click();
      await page.getByLabel("Field").selectOption("status");
      await page.getByLabel("Operator").selectOption({ label: "=" });
      await page.getByLabel("Filter value for status").selectOption("cancelled");
      await page.getByRole("button", { name: "Apply" }).click();

      // One cancelled booking; the chip records the active condition.
      await expect(page.getByText("status = cancelled")).toBeVisible();
      await expect(page.getByText("1 record", { exact: true })).toBeVisible();
      await expect(page.getByText("2026-08-04")).toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });

  test("switches partitions and scopes every read to the selection", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    try {
      await openRecordsTab(page, datastore);
      await expect(page.getByLabel("Records in bookings")).toBeVisible({
        timeout: 15_000,
      });

      // The catalog registered "dr-alt" on its first write (DD-010).
      await page.getByLabel("Partition").selectOption("dr-alt");

      await expect(page.getByText("1 record", { exact: true })).toBeVisible();
      await expect(page.getByText("2026-08-05")).toBeVisible();
      // Default-partition records are out of scope.
      await expect(page.getByText("2026-08-03")).not.toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });

  test("insert violating a unique constraint renders the declared message verbatim", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    try {
      await openRecordsTab(page, datastore);
      await page.getByRole("button", { name: "Insert record" }).click({ timeout: 15_000 });

      const dialog = page.getByRole("dialog", { name: "Insert record into bookings" });
      await expect(dialog).toBeVisible();

      // Duplicate the seeded confirmed 2026-08-03 09:00 slot. Status is
      // left unset — the server applies the declared default (confirmed),
      // landing exactly on `one_confirmed_per_slot`.
      await dialog.getByLabel("slot_date").fill("2026-08-03");
      await dialog.getByLabel("slot_time").fill("09:00:00");
      await dialog.getByRole("button", { name: "Insert" }).click();

      // The operator reads the same bytes the agent relays (DD-002).
      await expect(dialog.getByText("that slot is already booked").first()).toBeVisible();

      // Field-adjacent placement: the unique constraint declares
      // slot_date + slot_time, so both rows carry the message.
      const alerts = dialog.getByRole("alert");
      await expect(alerts.filter({ hasText: "that slot is already booked" }).first()).toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });

  test("edit submits a partial merge and explicit clear empties the field", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    try {
      await openRecordsTab(page, datastore);
      await expect(page.getByLabel("Records in bookings")).toBeVisible({
        timeout: 15_000,
      });

      // Edit the record that carries notes ("first visit").
      const row = page.getByRole("row").filter({ hasText: "first visit" });
      await row.getByRole("button", { name: /Edit record/ }).click();

      const dialog = page.getByRole("dialog", { name: "Edit record in bookings" });
      await expect(dialog).toBeVisible();

      // Dirty one field, clear another (explicit null). Exact match:
      // "Clear patient_phone" is a sibling accessible name.
      await dialog.getByLabel("patient_phone", { exact: true }).fill("+15550999");
      await dialog.getByRole("button", { name: "Clear notes" }).click();
      await expect(dialog.getByText("will be cleared")).toBeVisible();
      await dialog.getByRole("button", { name: "Save changes" }).click();

      await expect(dialog).not.toBeVisible();
      await expect(page.getByText("+15550999")).toBeVisible();
      await expect(page.getByText("first visit")).not.toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });

  test("deny-by-default renders the denied panel, never an empty grid", async ({
    page,
    stigmerClient,
  }) => {
    // No roles, no default_role: describe succeeds with empty access
    // lists — the SD-5 primary denied branch.
    const datastore = await createTestDatastore(stigmerClient, { grantAccess: false });
    try {
      await openRecordsTab(page, datastore);

      const panel = page.getByRole("status").filter({
        hasText: "You do not have record access",
      });
      await expect(panel).toBeVisible({ timeout: 15_000 });
      // Operator guidance names the fix.
      await expect(panel.getByText("default_role")).toBeVisible();
      // No write affordances leak through.
      await expect(page.getByRole("button", { name: "Insert record" })).not.toBeVisible();
    } finally {
      await datastore.cleanup();
    }
  });
});

test.describe("Guarded datastore delete", () => {
  test.beforeEach(async ({ page }) => {
    await pinActiveOrg(page);
  });

  test("blocks on agent references, then arms by typed slug and destroys", async ({
    page,
    stigmerClient,
  }) => {
    const datastore = await createTestDatastore(stigmerClient, { withRecords: true });
    // An agent whose datastore_usages references the datastore — the
    // never-forceable guard (DD-003: the usage edge is
    // authorization-bearing and must not dangle).
    const agent = await stigmerClient.agent.create({
      name: `e2e-ds-ref-${Date.now()}`,
      org: SYSTEM_ORG,
      instructions: "You read clinic records. Keep responses short.",
      datastoreUsages: [{ datastoreRef: { org: SYSTEM_ORG, slug: datastore.slug } }],
    });
    const agentId = agent.metadata!.id;

    try {
      await page.goto(`/library/datastores/${datastore.org}/${datastore.slug}`);
      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible({
        timeout: 15_000,
      });

      const openDeleteDialog = async () => {
        await page.getByRole("button", { name: "More actions" }).click();
        await page.getByRole("menuitem", { name: "Delete" }).click();
        return page.getByRole("dialog", { name: `Delete datastore ${datastore.slug}` });
      };

      // Status-informed counts, slug-typed arming.
      const dialog = await openDeleteDialog();
      await expect(dialog.getByText("4 records")).toBeVisible();
      const deleteButton = dialog.getByRole("button", { name: "Delete datastore" });
      await expect(deleteButton).toBeDisabled();
      await dialog
        .getByLabel(`Type ${datastore.slug} to confirm deletion`)
        .fill(datastore.slug);
      await expect(deleteButton).toBeEnabled();

      // The reference guard refuses — verbatim, naming the agent; the
      // console renders the guard, never pre-empts it.
      await deleteButton.click();
      const guardAlert = dialog.getByRole("alert");
      await expect(guardAlert).toContainText("referenced by 1 agent");
      await expect(guardAlert).toContainText(agent.metadata!.slug);

      // Detach (delete the referencing agent), then retry — the armed
      // dialog is still open; the server stays authoritative.
      await stigmerClient.agent.delete(agentId);
      await deleteButton.click();

      await expect(dialog).not.toBeVisible({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/library\/datastores$/);
    } finally {
      // Belt-and-braces: on the happy path the test itself already
      // deleted both resources, so these double-deletes are no-ops that
      // only matter when an assertion failed mid-journey. Deadline-bound
      // them — a redundant RPC on the long-lived worker client must not
      // convert a passing journey into a timeout.
      const deadline = <T>(p: Promise<T>) =>
        Promise.race([p.catch(() => {}), new Promise((r) => setTimeout(r, 5_000))]);
      await deadline(stigmerClient.agent.delete(agentId));
      await deadline(
        stigmerClient.datastore.delete({ resourceId: datastore.id, force: true }),
      );
    }
  });
});
