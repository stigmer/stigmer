/**
 * Pins the action bar's act rule (CON-01): an act that declares the
 * relation it needs is offered only when the server answered yes for the
 * bar's resource, never while the check is in flight, never when the
 * answer is no or the check failed, and never when the bar has no
 * resource; the primary act follows the same rule; acts that declare
 * nothing (copy, export) are offered to every reader; a relation several
 * acts need is asked once; acts given after the first render are asked
 * too; the menu separates its groups, in the order the acts give them,
 * and keeps acts with no group together; a bar left with nothing draws
 * nothing. A
 * list draws one bar per row, its menu named after the row, each row's
 * Remove checked on that row's own resource.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { openMenu } from "../../__tests__/helpers/open-menu";
import { ResourceActionBar } from "../ResourceActionBar";
import type { DetailAction } from "../types";

afterEach(cleanup);

const AGENT = { kind: "agent", id: "agt_1" } as const;

const COPY: DetailAction = { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: () => {} };
const EDIT_YAML: DetailAction = { id: "edit-yaml", label: "Edit YAML", group: "export", requires: "can_edit", onAction: () => {} };
const DELETE: DetailAction = {
  id: "delete",
  label: "Delete",
  group: "danger",
  variant: "destructive",
  requires: "can_delete",
  onAction: () => {},
};
const EDIT: DetailAction = { id: "edit", label: "Edit", requires: "can_edit", onAction: () => {} };

/** A client whose self-check answers each relation as `verdicts` says; a relation left out never answers. */
function client(verdicts: Partial<Record<string, boolean | Error>>) {
  const checkMyPermission = vi.fn(
    (input: { relation: string }) =>
      new Promise<{ isAuthorized: boolean }>((resolve, reject) => {
        const verdict = verdicts[input.relation];
        if (verdict instanceof Error) reject(verdict);
        else if (verdict !== undefined) resolve({ isAuthorized: verdict });
      }),
  );
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={{ grant: { checkMyPermission } } as never}>{children}</StigmerContext.Provider>
  );
  return { checkMyPermission, Wrapper };
}

async function settle() {
  await act(async () => {});
}

describe("ResourceActionBar: an act appears on the server's yes", () => {
  it("CON-01 offers an owner every act the server allows", async () => {
    const { Wrapper } = client({ can_edit: true, can_delete: true });
    render(<ResourceActionBar resource={AGENT} primaryAction={EDIT} actions={[COPY, EDIT_YAML, DELETE]} />, { wrapper: Wrapper });
    await settle();

    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Edit YAML" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("CON-01 offers a reader only the acts that change nothing", async () => {
    const { Wrapper } = client({ can_edit: false, can_delete: false });
    render(<ResourceActionBar resource={AGENT} primaryAction={EDIT} actions={[COPY, EDIT_YAML, DELETE]} />, { wrapper: Wrapper });
    await settle();

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit YAML" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("CON-01 offers no act that needs a relation while its check is in flight", async () => {
    const { Wrapper } = client({});
    render(<ResourceActionBar resource={AGENT} primaryAction={EDIT} actions={[COPY, DELETE]} />, { wrapper: Wrapper });

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Copy ID" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("CON-01 offers no act whose check failed", async () => {
    const { Wrapper } = client({ can_delete: new Error("unavailable") });
    render(<ResourceActionBar resource={AGENT} actions={[COPY, DELETE]} />, { wrapper: Wrapper });
    await settle();

    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
  });

  it("CON-01 never offers an act that needs a relation when the bar has no resource, and asks nothing", async () => {
    const { Wrapper, checkMyPermission } = client({ can_edit: true, can_delete: true });
    render(<ResourceActionBar primaryAction={EDIT} actions={[COPY, DELETE]} />, { wrapper: Wrapper });
    await settle();

    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.queryByRole("menuitem", { name: "Delete" })).toBeNull();
    expect(checkMyPermission).not.toHaveBeenCalled();
  });

  it("CON-01 draws nothing when the server allows none of its acts", async () => {
    const { Wrapper } = client({ can_edit: false, can_delete: false });
    const { container } = render(<ResourceActionBar resource={AGENT} primaryAction={EDIT} actions={[DELETE]} />, {
      wrapper: Wrapper,
    });
    await settle();

    expect(container.innerHTML).toBe("");
  });

  it("asks for an act given after the first render, and offers it on the server's yes", async () => {
    const { Wrapper } = client({ can_delete: true });
    const { rerender } = render(<ResourceActionBar resource={AGENT} actions={[COPY]} />, { wrapper: Wrapper });
    await settle();
    rerender(<ResourceActionBar resource={AGENT} actions={[COPY, DELETE]} />);
    await settle();

    await openMenu(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeTruthy();
  });

  it("separates its groups, in the acts' order, and keeps acts with no group together", async () => {
    const { Wrapper } = client({ can_edit: true, can_delete: true });
    const loose: DetailAction = { id: "pin", label: "Pin", onAction: () => {} };
    const looser: DetailAction = { id: "share", label: "Share", onAction: () => {} };
    render(<ResourceActionBar resource={AGENT} actions={[COPY, loose, EDIT_YAML, looser, DELETE]} />, { wrapper: Wrapper });
    await settle();

    await openMenu(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu");
    const order = Array.from(menu.querySelectorAll("[role='menuitem'], [role='separator']")).map((node) =>
      node.getAttribute("role") === "separator" ? "|" : (node.textContent ?? ""),
    );
    expect(order).toEqual(["Copy ID", "|", "Pin", "Share", "|", "Edit YAML", "|", "Delete"]);
  });

  it("asks a relation several acts need once", async () => {
    const { Wrapper, checkMyPermission } = client({ can_edit: true });
    render(<ResourceActionBar resource={AGENT} primaryAction={EDIT} actions={[EDIT_YAML]} />, { wrapper: Wrapper });
    await settle();

    expect(checkMyPermission).toHaveBeenCalledTimes(1);
    expect(checkMyPermission.mock.calls[0]?.[0]).toMatchObject({ relation: "can_edit", resource: { kind: "agent", id: "agt_1" } });
  });
});

describe("ResourceActionBar on a list row", () => {
  const ROW_ACTS: readonly DetailAction[] = [
    { id: "view", label: "View details", group: "row", onAction: () => {} },
    { id: "remove", label: "Remove", group: "danger", variant: "destructive", requires: "can_delete", onAction: () => {} },
  ];
  const PLUGIN = { kind: "plugin", id: "plg_linear" } as const;

  it("CON-01 offers an owner the row's Remove, checked on that row's plugin, under the row's menu name", async () => {
    const { Wrapper, checkMyPermission } = client({ can_delete: true });
    render(<ResourceActionBar resource={PLUGIN} menuLabel="Actions for linear" actions={ROW_ACTS} />, { wrapper: Wrapper });
    await settle();

    await openMenu(screen.getByRole("button", { name: "Actions for linear" }));
    expect(screen.getByRole("menuitem", { name: "Remove" })).toBeTruthy();
    expect(checkMyPermission.mock.calls[0]?.[0]).toMatchObject({ relation: "can_delete", resource: { kind: "plugin", id: "plg_linear" } });
  });

  it("CON-01 offers a member the row's View details and no Remove", async () => {
    const { Wrapper } = client({ can_delete: false });
    render(<ResourceActionBar resource={PLUGIN} menuLabel="Actions for linear" actions={ROW_ACTS} />, { wrapper: Wrapper });
    await settle();

    await openMenu(screen.getByRole("button", { name: "Actions for linear" }));
    expect(screen.getByRole("menuitem", { name: "View details" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });

  it("CON-01 offers no Remove while the row's check is in flight", async () => {
    const { Wrapper } = client({});
    render(<ResourceActionBar resource={PLUGIN} menuLabel="Actions for linear" actions={ROW_ACTS} />, { wrapper: Wrapper });

    await openMenu(screen.getByRole("button", { name: "Actions for linear" }));
    expect(screen.getByRole("menuitem", { name: "View details" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Remove" })).toBeNull();
  });
});
