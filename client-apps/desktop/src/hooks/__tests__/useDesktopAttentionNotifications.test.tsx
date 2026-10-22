// ---------------------------------------------------------------------------
// useDesktopAttentionNotifications — a system notification when a
// conversation needs the person
//
// The hook follows the active organization's attention once the person
// turned notifications on, shows each notice through the notification
// plugin, and shows none for the conversation the focused window has open.
// The permission is asked from the setting's switch: granted already asks
// nothing, and a refusal reads as not allowed.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { UseAttentionNotificationsOptions } from "@stigmer/react-sdk";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-notification", () => plugin);

const sdk = vi.hoisted(() => ({
  options: [] as UseAttentionNotificationsOptions[],
  on: true,
}));
vi.mock("@stigmer/react-sdk", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme" } } }),
  useAttentionNotificationsSetting: () => ({ on: sdk.on, set: vi.fn() }),
  useAttentionNotifications: (options: UseAttentionNotificationsOptions) => sdk.options.push(options),
}));

import {
  requestDesktopNotificationPermission,
  useDesktopAttentionNotifications,
} from "../useDesktopAttentionNotifications";

function at(path: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;
  };
}

function lastOptions(): UseAttentionNotificationsOptions {
  const options = sdk.options.at(-1);
  if (!options) throw new Error("the hook never followed attention");
  return options;
}

beforeEach(() => {
  vi.clearAllMocks();
  sdk.options = [];
  sdk.on = true;
});

describe("useDesktopAttentionNotifications", () => {
  it("follows the active organization while the setting is on, and shows each notice through the plugin", () => {
    renderHook(() => useDesktopAttentionNotifications(), { wrapper: at("/") });
    const options = lastOptions();
    expect(options.org).toBe("org_acme");
    expect(options.enabled).toBe(true);
    options.notify({ id: "a", sessionId: "s1", title: "Migrate the database", body: "Finished", reason: "finished" });
    expect(plugin.sendNotification).toHaveBeenCalledWith({ title: "Migrate the database", body: "Finished" });
  });

  it("follows nothing while the setting is off", () => {
    sdk.on = false;
    renderHook(() => useDesktopAttentionNotifications(), { wrapper: at("/") });
    expect(lastOptions().enabled).toBe(false);
  });

  it("holds back the notice for the conversation the focused window has open, and only that one", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    renderHook(() => useDesktopAttentionNotifications(), { wrapper: at("/sessions/s1") });
    const { isShowing } = lastOptions();
    expect(isShowing?.("s1")).toBe(true);
    expect(isShowing?.("s2")).toBe(false);
    focus.mockReturnValue(false);
    expect(isShowing?.("s1"), "a window in the background shows nothing").toBe(false);
    focus.mockRestore();
  });
});

describe("requestDesktopNotificationPermission", () => {
  it("asks nothing when the system already allows notifications", async () => {
    plugin.isPermissionGranted.mockResolvedValue(true);
    await expect(requestDesktopNotificationPermission()).resolves.toBe(true);
    expect(plugin.requestPermission).not.toHaveBeenCalled();
  });

  it("asks the system, and reads a refusal as not allowed", async () => {
    plugin.isPermissionGranted.mockResolvedValue(false);
    plugin.requestPermission.mockResolvedValueOnce("granted");
    await expect(requestDesktopNotificationPermission()).resolves.toBe(true);
    plugin.requestPermission.mockResolvedValueOnce("denied");
    await expect(requestDesktopNotificationPermission()).resolves.toBe(false);
  });
});
