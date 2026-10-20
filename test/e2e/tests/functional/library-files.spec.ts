import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/client";
import { create } from "@bufbuild/protobuf";
import { ListFilesRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { test, expect } from "../../fixtures";
import { ensureOrg } from "../../fixtures/seed-helpers";

/** The organization this journey seeds into and points the console at. */
const FILES_ORG = "e2e-files";

/**
 * The Library's Files page against the live OSS stack.
 *
 * The load-bearing behaviors:
 * - two files uploaded on the page are listed, and a File uploaded into a
 *   conversation is not (the page lists Files of no conversation);
 * - a File's preview sets it to Organization through Manage access, the
 *   server stores it, and the row's badge follows;
 * - Delete in the preview removes the File from the server and the list.
 *
 * The functional stack runs with sign-in off, where every caller may do
 * everything, so a member's view (no upload, no share) is proven by the
 * SDK's gate tests and the local-cloud walk, not here.
 */

/** Makes the files organization the console's active one (stored by id) before the first page loads. */
async function pinActiveOrg(page: Page, stigmerClient: Stigmer): Promise<string> {
  const id = await ensureOrg(stigmerClient, FILES_ORG, "E2E files");
  await page.addInitScript((org) => {
    localStorage.setItem("stigmer:activeOrg", org);
  }, id);
  return id;
}

/** A name two parallel workers never share. */
function uniqueName(prefix: string, extension: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extension}`;
}

test.describe("The Library's Files page", () => {
  test("uploads, lists only Files of no conversation, shares one with the organization, and deletes one", async ({
    page,
    stigmerClient,
  }) => {
    const org = await pinActiveOrg(page, stigmerClient);
    const ledger = uniqueName("e2e-ledger", "csv");
    const notes = uniqueName("e2e-notes", "md");
    const given = uniqueName("e2e-given", "txt");
    const created: string[] = [];
    try {
      // A conversation's File, which the page must not list.
      const session = await stigmerClient.session.create({
        name: `e2e-files-${Date.now()}`,
        org,
        subject: "Files page e2e",
      });
      const conversationFile = await stigmerClient.file.uploadFile({
        org,
        sessionId: session.metadata?.id ?? "",
        filename: given,
        content: new TextEncoder().encode("given"),
      });
      created.push(conversationFile.metadata?.id ?? "");

      await page.goto("/library/files");
      await expect(page.getByRole("heading", { name: "Files", level: 1 })).toBeVisible({ timeout: 15_000 });

      await page.getByLabel("Choose files to upload").setInputFiles([
        { name: ledger, mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") },
        { name: notes, mimeType: "text/markdown", buffer: Buffer.from("# notes\n") },
      ]);
      const workbench = page.getByLabel("File workbench");
      await expect(workbench.getByText(ledger)).toBeVisible({ timeout: 15_000 });
      await expect(workbench.getByText(notes)).toBeVisible();
      await expect(workbench.getByText(given)).toHaveCount(0);

      const listed = await stigmerClient.file.list(
        create(ListFilesRequestSchema, { org, withoutSession: true, pageSize: 100 }),
      );
      for (const file of listed.entries) {
        if (file.spec?.filename === ledger || file.spec?.filename === notes) created.push(file.metadata?.id ?? "");
      }

      // Share the ledger with the organization from its preview.
      await workbench.getByText(ledger).click();
      const preview = page.getByRole("dialog", { name: `Preview ${ledger}` });
      await expect(preview).toContainText("a,b", { timeout: 15_000 });
      await preview.getByRole("button", { name: "Manage access" }).click();
      const access = page.getByRole("dialog", { name: "Manage access" });
      await access.getByRole("button", { name: "Resource visibility: Private" }).click();
      await page.getByRole("option", { name: /^Organization/ }).click();
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(access.getByRole("button", { name: "Resource visibility: Organization" })).toBeVisible({
        timeout: 15_000,
      });
      await access.getByRole("button", { name: "Done" }).click();
      await page.keyboard.press("Escape");

      const ledgerId = listed.entries.find((f) => f.spec?.filename === ledger)?.metadata?.id ?? "";
      expect((await stigmerClient.file.get(ledgerId)).metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
      await expect(workbench.getByRole("row", { name: new RegExp(ledger) }).getByText("Organization")).toBeVisible({
        timeout: 15_000,
      });

      // Delete the notes from its preview.
      await workbench.getByText(notes).click();
      const notesPreview = page.getByRole("dialog", { name: `Preview ${notes}` });
      await notesPreview.getByRole("button", { name: "Delete" }).click();
      await notesPreview.getByRole("button", { name: "Delete", exact: true }).last().click();
      await expect(workbench.getByText(notes)).toHaveCount(0, { timeout: 15_000 });
      const notesId = listed.entries.find((f) => f.spec?.filename === notes)?.metadata?.id ?? "";
      await expect(stigmerClient.file.get(notesId)).rejects.toThrow();
    } finally {
      for (const id of created) {
        if (id) await stigmerClient.file.delete(id).catch(() => undefined);
      }
    }
  });
});
