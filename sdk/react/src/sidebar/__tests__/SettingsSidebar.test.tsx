import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { OrgProvider } from "../../organization/OrgProvider";
import { SETTINGS_NAV_GROUPS } from "../../settings/settings-nav";
import { SettingsSidebar } from "../SettingsSidebar";
import type { RenderSidebarLink } from "../types";

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

const renderAnchor: RenderSidebarLink = ({
  id,
  href,
  className,
  children,
  "aria-current": ariaCurrent,
}) => (
  <a href={href} data-row-id={id} aria-current={ariaCurrent} className={className}>
    {children}
  </a>
);

function renderSidebar(ui: ReactNode) {
  // No RPCs registered: the org switcher degrades gracefully, which is not
  // this suite's subject (covered by WorkspaceSidebar's transport test).
  const client = new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "test-token",
    customTransport: createRouterTransport(() => {}),
  });
  return render(
    <StigmerContext.Provider value={client}>
      <OrgProvider>{ui}</OrgProvider>
    </StigmerContext.Provider>,
  );
}

function baseProps() {
  return {
    groups: SETTINGS_NAV_GROUPS,
    renderLink: renderAnchor,
    footer: <span data-testid="footer-slot">footer</span>,
  };
}

describe("SettingsSidebar", () => {
  it("renders every group heading and item from the nav model", () => {
    const { container } = renderSidebar(<SettingsSidebar {...baseProps()} />);

    for (const group of SETTINGS_NAV_GROUPS) {
      expect(screen.getByText(group.label)).toBeTruthy();
      for (const item of group.items) {
        const basename = item.href.slice(item.href.lastIndexOf("/") + 1);
        const row = container.querySelector(`[data-row-id="${basename}"]`);
        expect(row?.getAttribute("href")).toBe(item.href);
      }
    }
  });

  it("matches the active row by exact path or subpath, never by sibling prefix", () => {
    const { container } = renderSidebar(
      <SettingsSidebar {...baseProps()} activePath="/settings/api-keys/rotate" />,
    );

    const active = container.querySelector('[data-row-id="api-keys"]')!;
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.className).toContain("stg:bg-sidebar-accent");

    // "/settings/api-keys/rotate" must not light up e.g. "/settings/members".
    const inactive = container.querySelector('[data-row-id="members"]')!;
    expect(inactive.getAttribute("aria-current")).toBeNull();
  });

  it("renders Back to Sessions as a resting (never-active) row targeting backHref", () => {
    const { container } = renderSidebar(
      <SettingsSidebar {...baseProps()} backHref="/sessions/ses_123" />,
    );

    const back = container.querySelector('[data-row-id="back-to-sessions"]')!;
    expect(back.getAttribute("href")).toBe("/sessions/ses_123");
    expect(back.textContent).toContain("Back to Sessions");
    // An exit, not a destination: always the resting-row treatment, never
    // the active accent — even though it is the row you "came from".
    expect(back.getAttribute("aria-current")).toBeNull();
    expect(back.className.split(" ")).toContain("stg:text-sidebar-muted-foreground");
    expect(back.className.split(" ")).not.toContain("stg:bg-sidebar-accent");
  });

  it("renders the footer slot", () => {
    renderSidebar(<SettingsSidebar {...baseProps()} />);
    expect(screen.getByTestId("footer-slot")).toBeTruthy();
  });
});
