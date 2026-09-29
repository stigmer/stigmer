import { describe, it, expect, vi } from "vitest";
import { matchRoutes } from "react-router-dom";
import { PLATFORM_SETTINGS_NAV_GROUP, SETTINGS_NAV_GROUPS } from "@stigmer/react";

// Every settings sidebar item has a desktop route (stigmer#1227). The sidebar
// is SDK-owned (settings-nav.ts), so an item can be added there without the
// desktop router growing its page, and the desktop app shipped Provider
// Standing exactly that way: a nav item leading to no route. The web
// console's twin check is in client-apps/web's static-export-routing test.

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-deep-link", () => ({
  onOpenUrl: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(false),
  requestPermission: vi.fn().mockResolvedValue("denied"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    listen: vi.fn().mockResolvedValue(() => {}),
  })),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

const hrefs = [...SETTINGS_NAV_GROUPS, PLATFORM_SETTINGS_NAV_GROUP].flatMap((group) =>
  group.items.map((item) => item.href),
);

describe("settings nav routes", () => {
  it.each(hrefs)("%s has a desktop route", async (href) => {
    const { router } = await import("../routes");
    const matches = matchRoutes(router.routes, href) ?? [];
    const leaf = matches.at(-1)?.route;
    expect(
      leaf?.path,
      `The settings sidebar links ${href} (sdk/react/src/settings/settings-nav.ts), ` +
        `but no route in client-apps/desktop/src/routes.tsx matches it. Add a lazy ` +
        `settings page over its SDK console, as the sibling routes do.`,
    ).toBe(href.split("/").at(-1));
  });
});
