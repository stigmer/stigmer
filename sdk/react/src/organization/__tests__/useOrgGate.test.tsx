// Pins useOrgGate as a pure derivation over useOrg() (20260913.02,
// sp.console-login Q-CL-5). The hook once carried a "provisioning" arm that
// polled for a personal organization the server was "still creating"; the
// cloud has created that organization synchronously inside
// provisionMyAccount since 20260911.11, and the step is best-effort, so by
// the time the identity gate is ready the organization list is final in
// every edition. Zero organizations is therefore `no-orgs` at once — no
// timers, no options beyond the route bypass — and the arms below fail if
// a wait ever comes back.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { OrgContextValue } from "../OrgProvider";

const mocks = vi.hoisted(() => ({
  org: null as OrgContextValue | null,
}));

vi.mock("../OrgProvider.js", () => ({
  useOrg: () => mocks.org,
}));

import { useOrgGate } from "../useOrgGate";

const acme = {
  metadata: { id: "acme", slug: "acme", name: "Acme" },
} as Organization;

function orgContext(overrides: Partial<OrgContextValue>): OrgContextValue {
  return {
    orgs: [],
    isLoading: false,
    error: null,
    retry: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  } as OrgContextValue;
}

describe("useOrgGate is a derivation, not a state machine", () => {
  afterEach(() => vi.useRealTimers());

  it("zero organizations is no-orgs immediately — no provisioning wait in any edition", () => {
    vi.useFakeTimers();
    mocks.org = orgContext({ orgs: [] });
    const { result } = renderHook(() => useOrgGate({ isBypassed: false }));
    expect(result.current.state).toEqual({ status: "no-orgs" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("the initial fetch is loading", () => {
    mocks.org = orgContext({ isLoading: true });
    const { result } = renderHook(() => useOrgGate({ isBypassed: false }));
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("a failed fetch is error with its message", () => {
    mocks.org = orgContext({ error: "boom" });
    const { result } = renderHook(() => useOrgGate({ isBypassed: false }));
    expect(result.current.state).toEqual({ status: "error", message: "boom" });
  });

  it("at least one organization is ready", () => {
    mocks.org = orgContext({ orgs: [acme] });
    const { result } = renderHook(() => useOrgGate({ isBypassed: false }));
    expect(result.current.state).toEqual({ status: "ready" });
  });

  it("a bypassed route is bypassed whatever the list says", () => {
    mocks.org = orgContext({ orgs: [], isLoading: true });
    const { result } = renderHook(() => useOrgGate({ isBypassed: true }));
    expect(result.current.state).toEqual({ status: "bypassed" });
  });

  it("hands the consumer useOrg's own retry and refresh", () => {
    const retry = vi.fn();
    const refresh = vi.fn();
    mocks.org = orgContext({ retry, refresh });
    const { result } = renderHook(() => useOrgGate({ isBypassed: false }));
    expect(result.current.retry).toBe(retry);
    expect(result.current.refresh).toBe(refresh);
  });
});
