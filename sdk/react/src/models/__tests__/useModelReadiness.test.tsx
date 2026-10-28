/**
 * useModelReadiness: the kit's one read of which models can run. Pins that
 * every wire availability maps to the union the faces read (a value newer
 * than this build reading as unknown, which never blocks), that a model on
 * an engine this build does not name is left out, that one organization's
 * faces share one cached answer under its key, that a refetch from one face
 * reaches every face mounted on the same organization, and that a null
 * organization, or a client that cannot ask, reads nothing and blocks
 * nothing.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import {
  GetModelReadinessOutputSchema,
  ModelReadinessSchema,
  ProviderAvailability,
  ProviderReadinessSchema,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { StigmerContext } from "../../context";
import { FetchCacheProvider } from "../../internal/FetchCacheProvider";
import { FetchCache } from "../../internal/fetch-cache";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { modelReadinessCacheKey, useModelReadiness } from "../useModelReadiness";
import { nothingRuns } from "../readiness";
import { ANTHROPIC_CONNECTED, NOTHING_CONNECTED, ORG_ID } from "./readiness-fixture";

afterEach(cleanup);

function clientAnswering(answer: () => unknown) {
  const getModelReadiness = vi.fn(async () => answer());
  return { client: { platform: { getModelReadiness } }, getModelReadiness };
}

function wrapperFor(client: unknown, cache?: FetchCache) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {cache === undefined ? (
          <FetchCacheProvider>{children}</FetchCacheProvider>
        ) : (
          <FetchCacheContext.Provider value={cache}>{children}</FetchCacheContext.Provider>
        )}
      </StigmerContext.Provider>
    );
  };
}

const EVERY_AVAILABILITY = create(GetModelReadinessOutputSchema, {
  providers: [
    { provider: "a", availability: ProviderAvailability.served_by_organization },
    { provider: "b", availability: ProviderAvailability.served_by_parent_organization, parentOrg: "acme-holdings" },
    { provider: "c", availability: ProviderAvailability.served_by_runners },
    { provider: "d", availability: ProviderAvailability.missing_from_organization },
    { provider: "e", availability: ProviderAvailability.missing_from_runners },
    { provider: "f", availability: ProviderAvailability.availability_unknown },
    { provider: "g", availability: ProviderAvailability.provider_availability_unspecified },
    { provider: "h", availability: 99 as ProviderAvailability },
  ].map((entry) => create(ProviderReadinessSchema, entry)),
  models: [
    create(ModelReadinessSchema, { harness: Harness.NATIVE, model: "m1", provider: "d", availability: ProviderAvailability.missing_from_organization }),
    create(ModelReadinessSchema, { harness: Harness.CLAUDE, model: "m2", provider: "a", availability: ProviderAvailability.served_by_organization }),
    create(ModelReadinessSchema, { harness: 42 as Harness, model: "m3", provider: "a", availability: ProviderAvailability.served_by_organization }),
  ],
});

describe("useModelReadiness", () => {
  it("maps every availability the contract names, and one newer than this build reads as unknown", async () => {
    const { client } = clientAnswering(() => EVERY_AVAILABILITY);
    const { result } = renderHook(() => useModelReadiness(ORG_ID), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.providers).not.toBeNull());
    expect(result.current.providers?.map((report) => report.availability)).toEqual([
      { state: "served", source: "organization", parentOrg: "" },
      { state: "served", source: "parent", parentOrg: "acme-holdings" },
      { state: "served", source: "runners", parentOrg: "" },
      { state: "missing", scope: "organization" },
      { state: "missing", scope: "runners" },
      { state: "unknown" },
      { state: "unknown" },
      { state: "unknown" },
    ]);
    expect(result.current.providers?.map((report) => report.provider)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });

  it("keeps each model on an engine this build names, and looks one up by engine and id", async () => {
    const { client } = clientAnswering(() => EVERY_AVAILABILITY);
    const { result } = renderHook(() => useModelReadiness(ORG_ID), { wrapper: wrapperFor(client) });

    await waitFor(() => expect(result.current.models).not.toBeNull());
    expect(result.current.models).toEqual([
      { harness: "native", modelId: "m1", provider: "d", availability: { state: "missing", scope: "organization" } },
      { harness: "claude", modelId: "m2", provider: "a", availability: { state: "served", source: "organization", parentOrg: "" } },
    ]);
    expect(result.current.readinessOf("native", "m1")?.provider).toBe("d");
    expect(result.current.readinessOf("claude", "m1")).toBeUndefined();
    expect(result.current.readinessOf("native", "unlisted")).toBeUndefined();
  });

  it("asks for the organization it is given, under that organization's cache key", async () => {
    const cache = new FetchCache();
    const { client, getModelReadiness } = clientAnswering(() => NOTHING_CONNECTED);
    const { result } = renderHook(() => useModelReadiness(ORG_ID), { wrapper: wrapperFor(client, cache) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getModelReadiness).toHaveBeenCalledExactlyOnceWith(ORG_ID);
    expect(modelReadinessCacheKey(ORG_ID)).toBe(`model-readiness:${ORG_ID}`);
    expect(cache.get(modelReadinessCacheKey(ORG_ID))).toBe(NOTHING_CONNECTED);
  });

  it("starts a second face of the same organization from the cached answer", async () => {
    const cache = new FetchCache();
    cache.set(modelReadinessCacheKey(ORG_ID), ANTHROPIC_CONNECTED);
    const { client } = clientAnswering(() => new Promise(() => {}));
    const { result } = renderHook(() => useModelReadiness(ORG_ID), { wrapper: wrapperFor(client, cache) });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.readinessOf("native", "claude-sonnet-4.6")?.availability.state).toBe("served");
  });

  it("asks again in every face mounted on the organization when one face refetches after a save", async () => {
    let answer = NOTHING_CONNECTED;
    const cache = new FetchCache();
    const { client, getModelReadiness } = clientAnswering(() => answer);
    const wrapper = wrapperFor(client, cache);
    const launcher = renderHook(() => useModelReadiness(ORG_ID), { wrapper });
    const picker = renderHook(() => useModelReadiness(ORG_ID), { wrapper });
    await waitFor(() => expect(picker.result.current.models).not.toBeNull());
    expect(nothingRuns(picker.result.current.models)).toBe(true);
    const asked = getModelReadiness.mock.calls.length;

    answer = ANTHROPIC_CONNECTED;
    act(() => launcher.result.current.refetch());

    await waitFor(() => expect(nothingRuns(picker.result.current.models)).toBe(false));
    expect(nothingRuns(launcher.result.current.models)).toBe(false);
    expect(getModelReadiness.mock.calls.length).toBe(asked + 2);
  });

  it("asks again on refetch with no fetch cache mounted", async () => {
    let answer = NOTHING_CONNECTED;
    const { client, getModelReadiness } = clientAnswering(() => answer);
    const { result } = renderHook(() => useModelReadiness(ORG_ID), {
      wrapper: ({ children }) => <StigmerContext.Provider value={client as never}>{children}</StigmerContext.Provider>,
    });
    await waitFor(() => expect(result.current.models).not.toBeNull());

    answer = ANTHROPIC_CONNECTED;
    act(() => result.current.refetch());

    await waitFor(() => expect(result.current.readinessOf("native", "claude-sonnet-4.6")?.availability.state).toBe("served"));
    expect(getModelReadiness).toHaveBeenCalledTimes(2);
  });

  it("reads nothing for a null or empty organization", () => {
    const { client, getModelReadiness } = clientAnswering(() => NOTHING_CONNECTED);
    const nullOrg = renderHook(() => useModelReadiness(null), { wrapper: wrapperFor(client) });
    const emptyOrg = renderHook(() => useModelReadiness(""), { wrapper: wrapperFor(client) });

    expect(getModelReadiness).not.toHaveBeenCalled();
    for (const { result } of [nullOrg, emptyOrg]) {
      expect(result.current.providers).toBeNull();
      expect(result.current.models).toBeNull();
      expect(result.current.isLoading).toBe(false);
      expect(nothingRuns(result.current.models)).toBe(false);
    }
  });

  it("settles a client that cannot ask as an error, judging nothing", async () => {
    const { result } = renderHook(() => useModelReadiness(ORG_ID), { wrapper: wrapperFor({ platform: {} }) });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.models).toBeNull();
    expect(result.current.readinessOf("native", "claude-sonnet-4.6")).toBeUndefined();
  });
});

describe("nothingRuns", () => {
  it("is true only when the server judged models and every one is missing", () => {
    const missing = { state: "missing", scope: "organization" } as const;
    const unknown = { state: "unknown" } as const;
    expect(nothingRuns(null)).toBe(false);
    expect(nothingRuns([])).toBe(false);
    expect(nothingRuns([{ harness: "native", modelId: "a", provider: "anthropic", availability: missing }])).toBe(true);
    expect(
      nothingRuns([
        { harness: "native", modelId: "a", provider: "anthropic", availability: missing },
        { harness: "native", modelId: "b", provider: "openai", availability: unknown },
      ]),
    ).toBe(false);
  });
});
