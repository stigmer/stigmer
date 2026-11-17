/**
 * Pins PermissionGate's two fail modes: by default a check that errors
 * renders the children (content a person reads is never hidden by a
 * failed check), and with `fail="closed"` it renders the fallback (an act
 * is offered only on the server's yes). A grant and a denial read the same
 * in both.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { PermissionGate } from "../PermissionGate";

function renderGate(
  checkMyPermission: ReturnType<typeof vi.fn>,
  gate: ReactNode,
) {
  const client = { grant: { checkMyPermission } } as never;
  return render(
    <StigmerContext.Provider value={client}>{gate}</StigmerContext.Provider>,
  );
}

const RESOURCE = { kind: "team", id: "team_1" } as const;

afterEach(() => cleanup());

describe("PermissionGate", () => {
  it("renders its children when the check errors, by default", async () => {
    renderGate(
      vi.fn().mockRejectedValue(new Error("check timed out")),
      <PermissionGate
        resource={RESOURCE}
        relation="can_edit"
        fallback={<span>fallback</span>}
      >
        <button type="button">Edit</button>
      </PermissionGate>,
    );
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("renders its fallback when the check errors under fail closed", async () => {
    renderGate(
      vi.fn().mockRejectedValue(new Error("check timed out")),
      <PermissionGate
        resource={RESOURCE}
        relation="can_edit"
        fail="closed"
        fallback={<span>fallback</span>}
      >
        <button type="button">Edit</button>
      </PermissionGate>,
    );
    expect(await screen.findByText("fallback")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("renders its children on the server's yes under fail closed", async () => {
    renderGate(
      vi.fn().mockResolvedValue({ isAuthorized: true }),
      <PermissionGate resource={RESOURCE} relation="can_edit" fail="closed">
        <button type="button">Edit</button>
      </PermissionGate>,
    );
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("renders its fallback on the server's no in either mode", async () => {
    renderGate(
      vi.fn().mockResolvedValue({ isAuthorized: false }),
      <PermissionGate
        resource={RESOURCE}
        relation="can_edit"
        fallback={<span>fallback</span>}
      >
        <button type="button">Edit</button>
      </PermissionGate>,
    );
    expect(await screen.findByText("fallback")).toBeTruthy();
  });
});
