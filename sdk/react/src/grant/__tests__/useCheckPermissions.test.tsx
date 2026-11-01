/**
 * Pins useCheckPermissions, the self-check behind every act in the console
 * (CON-01): each relation reports its own yes, its own no and its own
 * flight; under `{ fail: "closed" }` an act's relation is `false` while its
 * check is in flight and when the check failed, so no act is offered before
 * the server's yes; a relation is asked once however often it is listed or
 * however the list is reordered, or a relation joins while another is still
 * in flight, and a verdict is served from the mount's cache; the answer
 * holds exactly the relations asked; a skipped (null) resource asks nothing. The single-relation hook is
 * this one for one relation, so its own suite pins the shared rest.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { useCheckPermissions, type UseCheckPermissionsReturn } from "../useCheckPermissions";
import type { CheckPermissionOptions, PermissionCheckResource } from "../useCheckPermission";

afterEach(cleanup);

const AGENT: PermissionCheckResource = { kind: "agent", id: "agt_1" };

type Relation = "can_edit" | "can_delete";

/** A self-check whose answers the test hands out per relation. */
function heldChecks() {
  const waiting = new Map<string, Array<(verdict: boolean) => void>>();
  const check = vi.fn(
    (input: { relation: string }) =>
      new Promise<{ isAuthorized: boolean }>((resolve) => {
        const list = waiting.get(input.relation) ?? [];
        list.push((verdict) => resolve({ isAuthorized: verdict }));
        waiting.set(input.relation, list);
      }),
  );
  const answer = async (relation: string, verdict: boolean) => {
    await act(async () => {
      for (const resolve of waiting.get(relation) ?? []) resolve(verdict);
      waiting.delete(relation);
    });
  };
  return { check, answer };
}

function wrapper(check: (input: { relation: string }) => Promise<unknown>) {
  const client = { grant: { checkMyPermission: check } };
  return function Wrapper({ children }: { children: ReactNode }) {
    return <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>;
  };
}

function Recorder({
  resource,
  relations,
  options,
  renders,
}: {
  resource: PermissionCheckResource | null;
  relations: readonly Relation[];
  options?: CheckPermissionOptions;
  renders: UseCheckPermissionsReturn<Relation>[];
}) {
  renders.push(useCheckPermissions(resource, relations, options));
  return null;
}

const CLOSED: CheckPermissionOptions = { fail: "closed" };

describe("useCheckPermissions for acts (fail closed)", () => {
  it("CON-01 reports every relation in flight and not allowed from the first render", () => {
    const { check } = heldChecks();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });

    expect(renders[0]).toEqual({
      can_edit: { allowed: false, isLoading: true, error: null, refetch: expect.any(Function) },
      can_delete: { allowed: false, isLoading: true, error: null, refetch: expect.any(Function) },
    });
  });

  it("CON-01 reports each relation's own yes and no as each answer lands", async () => {
    const { check, answer } = heldChecks();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });

    await answer("can_edit", true);
    expect(renders.at(-1)).toEqual({
      can_edit: { allowed: true, isLoading: false, error: null, refetch: expect.any(Function) },
      can_delete: { allowed: false, isLoading: true, error: null, refetch: expect.any(Function) },
    });

    await answer("can_delete", false);
    expect(renders.at(-1)).toEqual({
      can_edit: { allowed: true, isLoading: false, error: null, refetch: expect.any(Function) },
      can_delete: { allowed: false, isLoading: false, error: null, refetch: expect.any(Function) },
    });
  });

  it("CON-01 keeps a relation whose check failed not allowed, with the error", async () => {
    const check = vi.fn(async (input: { relation: string }) => {
      if (input.relation === "can_delete") throw new Error("unavailable");
      return { isAuthorized: true };
    });
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });
    await act(async () => {});

    expect(renders.at(-1)?.can_edit).toEqual({ allowed: true, isLoading: false, error: null, refetch: expect.any(Function) });
    expect(renders.at(-1)?.can_delete.allowed).toBe(false);
    expect(renders.at(-1)?.can_delete.isLoading).toBe(false);
    expect(renders.at(-1)?.can_delete.error?.message).toBe("unavailable");
  });

  it("CON-01 asks a failed relation again on refetch: in flight, then the server's answer; a held verdict is not asked again", async () => {
    let failing = true;
    const check = vi.fn(async (input: { relation: string }) => {
      if (input.relation === "can_delete" && failing) throw new Error("unavailable");
      return { isAuthorized: true };
    });
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });
    await act(async () => {});
    expect(renders.at(-1)?.can_delete.error?.message).toBe("unavailable");
    const asked = check.mock.calls.length;

    failing = false;
    act(() => renders.at(-1)?.can_delete.refetch());
    expect(renders.at(-1)?.can_delete).toMatchObject({ allowed: false, isLoading: true, error: null });
    await act(async () => {});

    expect(renders.at(-1)?.can_delete).toMatchObject({ allowed: true, isLoading: false, error: null });
    // Only the failed relation was asked again.
    expect(check.mock.calls.slice(asked).map(([input]) => input.relation)).toEqual(["can_delete"]);
  });

  it("CON-01 never asks, and never allows, without a resource", () => {
    const check = vi.fn();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={null} relations={["can_edit"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });

    expect(renders.at(-1)).toEqual({ can_edit: { allowed: false, isLoading: false, error: null, refetch: expect.any(Function) } });
    expect(check).not.toHaveBeenCalled();

    // There is nothing to ask again: a refetch without a resource asks nothing and stays settled.
    act(() => renders.at(-1)?.can_edit.refetch());
    expect(renders.at(-1)?.can_edit).toMatchObject({ allowed: false, isLoading: false });
    expect(check).not.toHaveBeenCalled();
  });
});

describe("useCheckPermissions: one question per relation", () => {
  it("asks a relation listed twice once, and a reordered list nothing new", async () => {
    const check = vi.fn(async () => ({ isAuthorized: true }));
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    const { rerender } = render(
      <Recorder resource={AGENT} relations={["can_edit", "can_delete", "can_edit"]} options={CLOSED} renders={renders} />,
      { wrapper: wrapper(check) },
    );
    await act(async () => {});
    expect(check).toHaveBeenCalledTimes(2);

    rerender(<Recorder resource={AGENT} relations={["can_delete", "can_edit"]} options={CLOSED} renders={renders} />);
    await act(async () => {});
    expect(check).toHaveBeenCalledTimes(2);
    expect(renders.at(-1)?.can_delete.allowed).toBe(true);
  });

  it("asks nothing again for a relation still in flight when another joins it", async () => {
    const { check, answer } = heldChecks();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    const { rerender } = render(<Recorder resource={AGENT} relations={["can_edit"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });
    rerender(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />);
    await act(async () => {});

    expect(check.mock.calls.map(([input]) => input.relation)).toEqual(["can_edit", "can_delete"]);
    await answer("can_edit", true);
    expect(renders.at(-1)?.can_edit.allowed).toBe(true);
  });

  it("returns the same answer object when the same relations come back in another order", async () => {
    const check = vi.fn(async () => ({ isAuthorized: true }));
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    const { rerender } = render(<Recorder resource={AGENT} relations={["can_edit", "can_delete"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });
    await act(async () => {});
    const settled = renders.at(-1);

    rerender(<Recorder resource={AGENT} relations={["can_delete", "can_edit"]} options={CLOSED} renders={renders} />);
    expect(renders.at(-1)).toBe(settled);
  });

  it("holds exactly the relations asked, and nothing for none", () => {
    const check = vi.fn();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={[]} options={CLOSED} renders={renders} />, { wrapper: wrapper(check) });

    expect(renders.at(-1)).toEqual({});
    expect(check).not.toHaveBeenCalled();
  });

  it("serves a verdict it holds from the mount's cache when a relation comes back", async () => {
    const check = vi.fn(async () => ({ isAuthorized: true }));
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    const { rerender } = render(<Recorder resource={AGENT} relations={["can_edit"]} renders={renders} />, {
      wrapper: wrapper(check),
    });
    await act(async () => {});
    rerender(<Recorder resource={AGENT} relations={["can_delete"]} renders={renders} />);
    await act(async () => {});
    rerender(<Recorder resource={AGENT} relations={["can_edit"]} renders={renders} />);
    await act(async () => {});

    expect(check).toHaveBeenCalledTimes(2);
    expect(renders.at(-1)).toEqual({ can_edit: { allowed: true, isLoading: false, error: null, refetch: expect.any(Function) } });
  });

  it("never reports one resource's answer for another", async () => {
    const { check, answer } = heldChecks();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    const { rerender } = render(<Recorder resource={AGENT} relations={["can_edit"]} options={CLOSED} renders={renders} />, {
      wrapper: wrapper(check),
    });
    await answer("can_edit", true);

    const firstForOther = renders.length;
    rerender(<Recorder resource={{ kind: "agent", id: "agt_2" }} relations={["can_edit"]} options={CLOSED} renders={renders} />);
    for (const value of renders.slice(firstForOther)) {
      expect(value.can_edit).toEqual({ allowed: false, isLoading: true, error: null, refetch: expect.any(Function) });
    }
  });

  it("reports reading's fail-open default while in flight", () => {
    const { check } = heldChecks();
    const renders: UseCheckPermissionsReturn<Relation>[] = [];
    render(<Recorder resource={AGENT} relations={["can_edit"]} renders={renders} />, { wrapper: wrapper(check) });

    expect(renders[0]).toEqual({ can_edit: { allowed: true, isLoading: true, error: null, refetch: expect.any(Function) } });
  });
});
