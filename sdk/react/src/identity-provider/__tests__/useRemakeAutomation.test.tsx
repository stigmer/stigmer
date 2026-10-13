/**
 * Pins "make it again as me": a schedule is copied under a temporary slug,
 * the old one deleted, and the copy given the old slug back; an evaluator
 * (one per agent) is deleted and created again; an eval is not made again
 * here; a failure is held and rethrown.
 */
import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { create } from "@bufbuild/protobuf";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { AccountAutomationSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { StigmerContext } from "../../context";
import { remakeable, useRemakeAutomation } from "../useRemakeAutomation";

function wrapper(client: Record<string, unknown>) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client as unknown as Stigmer}>{children}</StigmerContext.Provider>
  );
}

const automation = (kind: string, id: string) => create(AccountAutomationSchema, { kind, id, slug: "nightly", name: "Nightly" });

describe("useRemakeAutomation", () => {
  it("copies a schedule, deletes the old one, and gives the copy its slug back", async () => {
    const calls: string[] = [];
    const schedule = {
      get: vi.fn().mockResolvedValue(
        create(ScheduleSchema, { metadata: { id: "sch_old", slug: "nightly", name: "Nightly", org: "org_acme" }, spec: { cron: "0 3 * * *" } }),
      ),
      create: vi.fn(async (input: { slug?: string }) => {
        calls.push(`create ${input.slug?.startsWith("nightly-") ? "nightly-<suffix>" : input.slug}`);
        return create(ScheduleSchema, { metadata: { id: "sch_new" } });
      }),
      delete: vi.fn(async (id: string) => {
        calls.push(`delete ${id}`);
        return create(ScheduleSchema, {});
      }),
      rename: vi.fn(async (input: { resourceId: string; slug: string }) => {
        calls.push(`rename ${input.resourceId} ${input.slug}`);
        return create(ScheduleSchema, {});
      }),
    };
    const { result } = renderHook(() => useRemakeAutomation(), { wrapper: wrapper({ schedule }) });
    let id = "";
    await act(async () => {
      id = await result.current.remake(automation("schedule", "sch_old"));
    });
    expect(id).toBe("sch_new");
    expect(calls).toEqual(["create nightly-<suffix>", "delete sch_old", "rename sch_new nightly"]);
  });

  it("deletes an evaluator and creates it again", async () => {
    const calls: string[] = [];
    const evaluator = {
      get: vi.fn().mockResolvedValue(create(EvaluatorSchema, { metadata: { id: "evl_old", name: "Judge", org: "org_acme" }, spec: { agentId: "agt_1" } })),
      delete: vi.fn(async (id: string) => {
        calls.push(`delete ${id}`);
        return create(EvaluatorSchema, {});
      }),
      create: vi.fn(async () => {
        calls.push("create");
        return create(EvaluatorSchema, { metadata: { id: "evl_new" } });
      }),
    };
    const { result } = renderHook(() => useRemakeAutomation(), { wrapper: wrapper({ evaluator }) });
    await act(async () => {
      expect(await result.current.remake(automation("evaluator", "evl_old"))).toBe("evl_new");
    });
    expect(calls).toEqual(["delete evl_old", "create"]);
  });

  it("makes no eval again here, and holds the failure", async () => {
    expect(remakeable({ kind: "plugin_eval" })).toBe(false);
    expect(remakeable({ kind: "schedule" })).toBe(true);
    const { result } = renderHook(() => useRemakeAutomation(), { wrapper: wrapper({}) });
    await act(async () => {
      await expect(result.current.remake(automation("plugin_eval", "pev_1"))).rejects.toThrow("made again from its parent's page");
    });
    expect(result.current.error?.message).toContain("made again from its parent's page");
    expect(result.current.remaking).toBeNull();
  });
});
