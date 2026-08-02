import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { DeploymentModeContext } from "../../deployment-mode";
import { useChannelTemplateReadiness } from "../useChannelTemplateReadiness";

function makeChannel(overrides?: {
  installState?: AgentChannelInstallState;
  enabled?: boolean;
  proactiveMessagingEnabled?: boolean;
}): AgentChannel {
  return {
    metadata: { id: "ach_1", org: "acme", slug: "wa-main" },
    spec: {
      enabled: overrides?.enabled ?? true,
      proactiveMessagingEnabled: overrides?.proactiveMessagingEnabled ?? true,
    },
    status: {
      installState:
        overrides?.installState ?? AgentChannelInstallState.installed,
    },
  } as unknown as AgentChannel;
}

function wrapper(mode: "cloud" | "local" = "cloud") {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <DeploymentModeContext.Provider value={mode}>
        {children}
      </DeploymentModeContext.Provider>
    );
  };
}

function readinessOf(
  channel: AgentChannel,
  mode: "cloud" | "local" = "cloud",
) {
  const { result } = renderHook(() => useChannelTemplateReadiness(channel), {
    wrapper: wrapper(mode),
  });
  return result.current;
}

describe("useChannelTemplateReadiness", () => {
  it("is ready for an installed, enabled, proactive channel on cloud", () => {
    expect(readinessOf(makeChannel())).toEqual({ status: "ready" });
  });

  it("is cloud-only on a local deployment — the template registry is cloud runtime", () => {
    expect(readinessOf(makeChannel(), "local")).toEqual({
      status: "cloud-only",
    });
  });

  it("is not-installed for a pending install", () => {
    expect(
      readinessOf(
        makeChannel({
          installState: AgentChannelInstallState.pending_install,
        }),
      ),
    ).toEqual({ status: "not-installed" });
  });

  it("is not-installed for a revoked install — coarse on purpose, describeChannel carries the distinction", () => {
    expect(
      readinessOf(
        makeChannel({ installState: AgentChannelInstallState.revoked }),
      ),
    ).toEqual({ status: "not-installed" });
  });

  it("is channel-off when the serving switch is off", () => {
    expect(readinessOf(makeChannel({ enabled: false }))).toEqual({
      status: "channel-off",
    });
  });

  it("is not-proactive when the grant is missing", () => {
    expect(
      readinessOf(makeChannel({ proactiveMessagingEnabled: false })),
    ).toEqual({ status: "not-proactive" });
  });

  // The gate order is the server's (ChannelMessagingReach.resolveDirect:
  // installed → enabled → proactive). A channel failing several gates
  // must report the FIRST, so the teaching state names the next fix.
  it("resolves gates in the server's order — first failure wins", () => {
    expect(
      readinessOf(
        makeChannel({
          installState: AgentChannelInstallState.pending_install,
          enabled: false,
          proactiveMessagingEnabled: false,
        }),
        "local",
      ),
    ).toEqual({ status: "cloud-only" });

    expect(
      readinessOf(
        makeChannel({
          installState: AgentChannelInstallState.pending_install,
          enabled: false,
          proactiveMessagingEnabled: false,
        }),
      ),
    ).toEqual({ status: "not-installed" });

    expect(
      readinessOf(
        makeChannel({ enabled: false, proactiveMessagingEnabled: false }),
      ),
    ).toEqual({ status: "channel-off" });
  });

  it("treats a channel with no status/spec as not yet installed", () => {
    const bare = { metadata: { id: "ach_2" } } as unknown as AgentChannel;
    expect(readinessOf(bare)).toEqual({ status: "not-installed" });
  });
});
