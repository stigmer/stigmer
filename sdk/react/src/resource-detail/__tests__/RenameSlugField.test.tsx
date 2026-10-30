/**
 * Pins the shared slug field:
 *
 *   - ResourceSlugField asks can_delete on the resource and, failing
 *     closed, shows its fallback to anyone the server has not said may
 *     delete (rename) it;
 *   - a rename sends the trimmed new slug, reports the renamed resource,
 *     and stays settling (disabled) until the page shows another slug, so
 *     one rename is in flight at a time; Enter renames too;
 *   - a refusal is shown in place of the hint, in the server's words, and
 *     an edit clears it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";

import { StigmerContext } from "@stigmer/react-core";
import { RESOURCE_RENAME_HINT, ResourceSlugField } from "../RenameSlugField.js";

afterEach(cleanup);

interface Relation {
  readonly relation: string;
  readonly resource?: { kind: string; id: string };
}

function renderField({
  allowed,
  rename = async ({ slug }: { slug: string }) => ({
    metadata: { id: "agt_1", slug },
  }),
  currentSlug = "test-bot",
  onRenamed = vi.fn(),
}: {
  allowed: boolean;
  rename?: (input: { slug: string }) => Promise<unknown>;
  currentSlug?: string;
  onRenamed?: ReturnType<typeof vi.fn>;
}) {
  const client = {
    agent: { rename: vi.fn(rename) },
    grant: {
      checkMyPermission: vi.fn(async (_input: Relation) => ({
        isAuthorized: allowed,
      })),
    },
  };
  const view = (slug: string) => (
    <StigmerContext.Provider value={client as never}>
      <ResourceSlugField
        kind="agent"
        resourceId="agt_1"
        currentSlug={slug}
        onRenamed={onRenamed}
        fallback={<span>read-only {slug}</span>}
      />
    </StigmerContext.Provider>
  );
  const rendered = render(view(currentSlug));
  return {
    client,
    onRenamed,
    rerender: (slug: string) => rendered.rerender(view(slug)),
  };
}

describe("ResourceSlugField", () => {
  it("shows the fallback to a caller who may not delete the resource, after asking can_delete on it", async () => {
    const { client } = renderField({ allowed: false });
    await waitFor(() =>
      expect(client.grant.checkMyPermission).toHaveBeenCalled(),
    );
    const [asked] = client.grant.checkMyPermission.mock.calls[0]!;
    expect(asked.relation).toBe("can_delete");
    expect(asked.resource).toMatchObject({ kind: "agent", id: "agt_1" });
    expect(screen.getByText("read-only test-bot")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("renames to the trimmed slug, reports the renamed resource, and settles until the page shows another slug", async () => {
    const { client, onRenamed, rerender } = renderField({ allowed: true });
    const input = await screen.findByLabelText("Slug");
    expect(screen.getByText(RESOURCE_RENAME_HINT)).toBeTruthy();
    const button = screen.getByRole("button", {
      name: "Rename",
    }) as HTMLButtonElement;
    expect(button.disabled, "nothing to rename to yet").toBe(true);

    fireEvent.change(input, { target: { value: "  support-bot " } });
    fireEvent.click(button);

    await waitFor(() => expect(onRenamed).toHaveBeenCalledOnce());
    expect(client.agent.rename.mock.calls[0]![0]).toMatchObject({
      resourceId: "agt_1",
      slug: "support-bot",
    });
    expect(
      (onRenamed.mock.calls[0]![0] as { metadata: { slug: string } }).metadata
        .slug,
    ).toBe("support-bot");
    expect(
      (screen.getByLabelText("Slug") as HTMLInputElement).disabled,
      "settling",
    ).toBe(true);

    rerender("support-bot");
    await waitFor(() =>
      expect((screen.getByLabelText("Slug") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    expect((screen.getByLabelText("Slug") as HTMLInputElement).value).toBe(
      "support-bot",
    );
  });

  it("renames on Enter", async () => {
    const { client } = renderField({ allowed: true });
    const input = await screen.findByLabelText("Slug");
    fireEvent.change(input, { target: { value: "support-bot" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(client.agent.rename).toHaveBeenCalledOnce());
  });

  it("shows a refusal in the server's words, and clears it on the next edit", async () => {
    renderField({
      allowed: true,
      rename: async () => {
        throw new ConnectError(
          "Agent slug 'taken' was recently another agent's, and still leads to it",
          Code.AlreadyExists,
        );
      },
    });
    const input = await screen.findByLabelText("Slug");
    fireEvent.change(input, { target: { value: "taken" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /recently another agent's/,
    );
    expect(
      (screen.getByLabelText("Slug") as HTMLInputElement).disabled,
      "a refusal does not settle",
    ).toBe(false);
    fireEvent.change(input, { target: { value: "taken-2" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
