/**
 * Pins PlatformClientsSection's posture gate: every edition serves platform
 * clients, but only a server that authenticates its callers mints their
 * tokens. On such a server the section offers the create button and no
 * notice; on a server that says it trusts every request it explains why no
 * client can be created there and offers no create button; on a server too
 * old to report its posture it offers the button and no notice, because a
 * console that ships ahead of its server must not claim a limitation the
 * server never reported; while the server's answer is still loading it
 * offers neither, so no button flashes and disappears. The list panel is
 * proven by its own tests and stubbed here.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { UseServerInfoReturn } from "../../server-info";

let serverInfo: UseServerInfoReturn;

vi.mock("../../server-info.js", () => ({
  useServerInfo: () => serverInfo,
}));
vi.mock("../../organization/OrgProvider.js", () => ({
  useActiveOrgSlug: () => "acme",
}));
vi.mock("../../platform-client/PlatformClientListPanel.js", () => ({
  PlatformClientListPanel: ({ org }: { org: string }) => (
    <div data-testid="list-panel">clients of {org}</div>
  ),
}));

import { PlatformClientsSection } from "../PlatformClientsSection";

/** A server that has answered; `undefined` is a server that predates the posture field. */
function answering(
  authenticationRequired: boolean | undefined,
): UseServerInfoReturn {
  return {
    serverInfo: {
      deploymentMode: "local",
      edition: 1,
      version: "dev",
      authenticationRequired,
    },
    isLoading: false,
    error: null,
  };
}

const LOADING: UseServerInfoReturn = {
  serverInfo: null,
  isLoading: true,
  error: null,
};

afterEach(cleanup);

describe("PlatformClientsSection's posture gate", () => {
  it("offers the create button and no notice on a server that authenticates its callers", () => {
    serverInfo = answering(true);
    render(<PlatformClientsSection />);
    expect(
      screen.getByRole("button", { name: /new platform client/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
    expect(screen.getByTestId("list-panel").textContent).toContain("acme");
  });

  it("explains the missing identity provider and offers no create button on a server that trusts every request", () => {
    serverInfo = answering(false);
    render(<PlatformClientsSection />);
    expect(screen.getByText(/trusts every request/i)).toBeTruthy();
    expect(screen.getByText("STIGMER_OIDC_ISSUER")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(
      screen.getByTestId("list-panel"),
      "existing clients stay listed",
    ).toBeTruthy();
  });

  it("offers the create button and no notice on a server too old to report its posture", () => {
    serverInfo = answering(undefined);
    render(<PlatformClientsSection />);
    expect(
      screen.getByRole("button", { name: /new platform client/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
  });

  it("offers neither while the server's answer is loading", () => {
    serverInfo = LOADING;
    render(<PlatformClientsSection />);
    expect(
      screen.queryByRole("button", { name: /new platform client/i }),
    ).toBeNull();
    expect(screen.queryByText(/trusts every request/i)).toBeNull();
  });
});
