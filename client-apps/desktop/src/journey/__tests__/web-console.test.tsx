/**
 * Pins where the app's invite links point: at the build's web console only
 * while the chosen server is the build's own, which that console fronts.
 * Connected to any other server the app makes no link (the kit's `null`),
 * so no invitation token for one server is handed to another's console, and
 * the journey's page says the same of the join-by-sign-in address.
 */
import { describe, expect, it, vi } from "vitest";
import { render, renderHook } from "@testing-library/react";

const server = vi.hoisted(() => ({ origin: "" }));
vi.mock("../../server/ServerProvider", () => ({ useServer: () => ({ origin: server.origin }) }));
vi.mock("../../config", () => ({
  CONSOLE_URL: "https://app.stigmer.ai",
  buildDefaultServer: () => "https://api.stigmer.ai",
}));
const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("@stigmer/react-sdk", () => ({
  BringOthersIn: (props: Record<string, unknown>) => {
    seen.props.push(props);
    return null;
  },
  useOrgSlugForId: () => (id: string) => id,
}));
vi.mock("@stigmer/react-sdk/console", () => ({
  InvitationsSection: (props: Record<string, unknown>) => {
    seen.props.push(props);
    return null;
  },
}));

import { DesktopBringOthersIn, DesktopInvitationsSection, frontsServer, useWebConsoleInviteUrl } from "../web-console";

describe("the desktop app's invite links", () => {
  it("open the build's web console while the chosen server is the build's own", () => {
    server.origin = "https://api.stigmer.ai";
    const { result } = renderHook(() => useWebConsoleInviteUrl());
    expect(result.current?.("tok")).toBe("https://app.stigmer.ai/invite/tok");
  });

  it("are not made for another server, whose web console the app does not know", () => {
    server.origin = "https://stigmer.acme.example";
    expect(renderHook(() => useWebConsoleInviteUrl()).result.current).toBeNull();

    seen.props = [];
    render(<DesktopBringOthersIn />);
    render(<DesktopInvitationsSection />);
    expect(seen.props[0]).toMatchObject({ buildInviteUrl: null, consoleUrl: null });
    expect(seen.props[1]).not.toHaveProperty("buildInviteUrl");
  });

  it("compare origins, and refuse an unknown or malformed server", () => {
    expect(frontsServer("https://api.stigmer.ai", "https://api.stigmer.ai/")).toBe(true);
    expect(frontsServer("", "https://api.stigmer.ai")).toBe(false);
    expect(frontsServer("not a url", "https://api.stigmer.ai")).toBe(false);
  });
});
