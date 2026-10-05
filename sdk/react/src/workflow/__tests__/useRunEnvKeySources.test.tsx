/**
 * Pins when useRunEnvKeySources says a run reads the person's personal
 * environment: only for a workflow and a run that name the same
 * organization. Neither naming one is no match, so nothing is read and no
 * key is marked personal. While the organizations that match an id to a
 * slug are still loading, an untyped key is pending, and it never reads as
 * missing on its way to personal. The sources themselves are pinned
 * through the run flow in `useRunWorkflowFlow.test.tsx`.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import type { Stigmer } from "@stigmer/sdk";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { StigmerContext } from "../../context";
import { OrgProvider } from "../../organization/OrgProvider";
import { useRunEnvKeySources, type RunEnvKeySource } from "../useRunEnvKeySources";

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

  it("holds an untyped key pending while the organizations load, and never reads it as missing on its way to personal", async () => {
    let releaseOrgs: () => void = () => {};
    const orgsLoaded = new Promise<void>((resolve) => {
      releaseOrgs = resolve;
    });
    const findMyOrganizations = vi.fn(async () => {
      await orgsLoaded;
      return { entries: [{ metadata: { id: "org_acme", slug: "acme" } }] };
    });
    const list = vi.fn(async () => ({
      items: [
        {
          metadata: { id: "env-personal", org: "org_acme" },
          spec: { data: { DB_URL: { value: "", isSecret: true } } },
        },
      ],
      totalCount: 1,
    }));
    const client = {
      organization: { findMyOrganizations },
      environment: { list },
    } as unknown as Stigmer;

    const seen: RunEnvKeySource[] = [];
    const { result } = renderHook(
      () => {
        const sources = useRunEnvKeySources(workflowIn("org_acme"), "acme", NOTHING_TYPED);
        const source = sources.sources.DB_URL;
        if (source) seen.push(source);
        return sources;
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <StigmerContext.Provider value={client}>
            <OrgProvider>{children}</OrgProvider>
          </StigmerContext.Provider>
        ),
      },
    );

    expect(result.current.sources).toEqual({ DB_URL: "pending" });
    expect(result.current.isLoading).toBe(true);
    expect(list).not.toHaveBeenCalled();

    releaseOrgs();
    await waitFor(() => expect(result.current.sources).toEqual({ DB_URL: "personal" }));
    expect(result.current.readsPersonalEnvironment).toBe(true);
    expect(result.current.isLoading).toBe(false);
    expect(seen).not.toContain("missing");
  });
});
