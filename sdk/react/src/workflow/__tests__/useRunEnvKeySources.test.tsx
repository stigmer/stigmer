/**
 * Pins when useRunEnvKeySources says a run reads the person's personal
 * environment: only for a workflow and a run that name the same
 * organization. Neither naming one is no match, so nothing is read and no
 * key is marked personal. The sources themselves are pinned through the
 * run flow in `useRunWorkflowFlow.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { StigmerContext } from "../../context";
import { useRunEnvKeySources } from "../useRunEnvKeySources";

const NOTHING_TYPED: Readonly<Record<string, string>> = {};

function workflowIn(org: string) {
  return create(WorkflowSchema, {
    metadata: { id: "wfl_1", org },
    spec: { env: { DB_URL: { isSecret: true } } },
  });
}

function renderSources(workflowOrg: string, runOrg: string) {
  const list = vi.fn(async () => ({
    items: [
      {
        metadata: { id: "env-personal", org: runOrg },
        spec: { data: { DB_URL: { value: "", isSecret: true } } },
      },
    ],
    totalCount: 1,
  }));
  const client = { environment: { list } } as unknown as Stigmer;
  const view = renderHook(() => useRunEnvKeySources(workflowIn(workflowOrg), runOrg, NOTHING_TYPED), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
    ),
  });
  return { ...view, list };
}

describe("useRunEnvKeySources — whether the run reads the personal environment", () => {
  it("reads it for a workflow of the run's organization", async () => {
    const { result, list } = renderSources("org_acme", "org_acme");

    expect(result.current.readsPersonalEnvironment).toBe(true);
    await waitFor(() => expect(result.current.sources).toEqual({ DB_URL: "personal" }));
    expect(list).toHaveBeenCalled();
  });

  it("reads nothing when neither the workflow nor the run names an organization", () => {
    const { result, list } = renderSources("", "");

    expect(result.current.readsPersonalEnvironment).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.sources).toEqual({ DB_URL: "missing" });
    expect(list).not.toHaveBeenCalled();
  });
});
