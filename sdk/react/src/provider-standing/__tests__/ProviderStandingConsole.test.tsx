import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { StigmerError } from "@stigmer/sdk";
import {
  ProviderStandingEntrySchema,
  ProviderStandingViewSchema,
} from "@stigmer/protos/ai/stigmer/platform/providerstanding/v1/io_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { ProviderStandingConsole } from "../ProviderStandingConsole";

function createMockStigmer(getStandingView: ReturnType<typeof vi.fn>) {
  return {
    providerStanding: { getStandingView },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return create(ProviderStandingEntrySchema, {
    provider: "anthropic",
    status: "healthy",
    httpStatus: 200,
    latencyMs: BigInt(842),
    errorSummary: "",
    checkedAt: timestampFromDate(new Date()),
    ...overrides,
  });
}

function view(entries: ReturnType<typeof entry>[]) {
  return create(ProviderStandingViewSchema, { providers: entries });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProviderStandingConsole", () => {
  it("renders one card per provider with status, latency, and probe time", async () => {
    const client = createMockStigmer(
      vi.fn().mockResolvedValue(
        view([
          entry(),
          entry({
            provider: "openai",
            status: "platform_billing",
            httpStatus: 429,
            latencyMs: BigInt(0),
            errorSummary: "insufficient_quota: billing hard limit reached",
          }),
        ]),
      ),
    );
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByText("anthropic")).toBeTruthy();
    });
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(screen.getByText("842ms")).toBeTruthy();

    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("Billing rejected")).toBeTruthy();
    expect(screen.getByText("429")).toBeTruthy();
    expect(
      screen.getByText("insufficient_quota: billing hard limit reached"),
    ).toBeTruthy();
  });

  it("flags a verdict older than the probe-silence window as stale", async () => {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const client = createMockStigmer(
      vi.fn().mockResolvedValue(
        view([entry({ checkedAt: timestampFromDate(fourHoursAgo) })]),
      ),
    );
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByText(/— stale/)).toBeTruthy();
    });
  });

  it("degrades an unknown future status label to a muted badge with the raw label", async () => {
    const client = createMockStigmer(
      vi.fn().mockResolvedValue(view([entry({ status: "rate_limited" })])),
    );
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByText("rate_limited")).toBeTruthy();
    });
  });

  it("shows the designed access notice on permission denied, not a raw RPC error", async () => {
    const client = createMockStigmer(
      vi.fn().mockRejectedValue(
        new StigmerError("permission-denied", "only platform operators can view provider standing", 7),
      ),
    );
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByText("Platform operator access required")).toBeTruthy();
    });
  });

  it("shows the error message for non-permission failures", async () => {
    const client = createMockStigmer(
      vi.fn().mockRejectedValue(new StigmerError("internal", "standing lookup failed", 13)),
    );
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("explains the empty state before the probe's first pass", async () => {
    const client = createMockStigmer(vi.fn().mockResolvedValue(view([])));
    render(<ProviderStandingConsole />, { wrapper: wrapper(client) });

    await waitFor(() => {
      expect(screen.getByText(/No probe verdicts recorded yet/)).toBeTruthy();
    });
  });
});
