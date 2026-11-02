// ---------------------------------------------------------------------------
// useDesktopAttentionNotifications — a system notification when a
// conversation needs the person
//
// The hook follows the active organization's attention once the person
// turned notifications on, shows each notice through the notification
// plugin with the conversation it is about in its data, and shows none for
// the conversation the focused window has open. The permission is asked from
// the setting's switch: granted already asks nothing, and a refusal reads as
// not allowed. A click brings the window forward on that conversation.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import type { UseAttentionNotificationsOptions } from "@stigmer/react-sdk";
import type { NotificationClickedData } from "@choochmeque/tauri-plugin-notifications-api";
import { mockTauri } from "../../__test-utils__/tauri";

const plugin = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
  onNotificationClicked: vi.fn(),
}));
vi.mock("@choochmeque/tauri-plugin-notifications-api", () => plugin);

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
  useOpenNotifiedConversation,
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
    expect(plugin.sendNotification).toHaveBeenCalledWith({
      title: "Migrate the database",
      body: "Finished",
      extra: { sessionId: "s1" },
    });
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

describe("useDesktopAttentionNotifications: which conversation the window shows", () => {
  it("reads a conversation only from a path that starts with /sessions/", () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    renderHook(() => useDesktopAttentionNotifications(), { wrapper: at("/settings/sessions/s1") });
    expect(lastOptions().isShowing?.("s1")).toBe(false);
    focus.mockRestore();
  });

  it("follows the window to the next conversation it opens", async () => {
    const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { result } = renderHook(
      () => {
        useDesktopAttentionNotifications();
        return useNavigate();
      },
      { wrapper: at("/sessions/s1") },
    );

    await act(async () => {
      await result.current("/sessions/s2");
    });

    expect(lastOptions().isShowing?.("s2")).toBe(true);
    expect(lastOptions().isShowing?.("s1")).toBe(false);
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

describe("DSK-04 a notification opens the conversation it is about", () => {
  /** The click listener the hook registered, as the plugin would call it. */
  function clickListener(): (click: NotificationClickedData) => void {
    const listener = plugin.onNotificationClicked.mock.calls.at(-1)?.[0];
    if (!listener) throw new Error("the hook registered no click listener");
    return listener;
  }

  function renderListener() {
    const unregister = vi.fn().mockResolvedValue(undefined);
    plugin.onNotificationClicked.mockResolvedValue({ unregister });
    const tauri = mockTauri({ show_main_window: () => null });
    let path = "";
    const rendered = renderHook(
      () => {
        useOpenNotifiedConversation();
        path = useLocation().pathname;
      },
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <MemoryRouter initialEntries={["/dashboard"]}>{children}</MemoryRouter>
        ),
      },
    );
    return { tauri, unregister, rendered, path: () => path };
  }

  it("brings the window forward on the clicked notice's conversation", async () => {
    const { tauri, path } = renderListener();

    await act(async () => {
      clickListener()({ id: 7, data: { sessionId: "ses_42" } });
    });

    expect(tauri.callsTo("show_main_window")).toHaveLength(1);
    expect(path()).toBe("/sessions/ses_42");
  });

  it("escapes a conversation id before it becomes a path", async () => {
    const { path } = renderListener();

    await act(async () => {
      clickListener()({ id: 7, data: { sessionId: "a/b?c" } });
    });

    expect(path()).toBe("/sessions/a%2Fb%3Fc");
  });

  it("only brings the window forward for a notice that names no conversation", async () => {
    const { tauri, path } = renderListener();

    await act(async () => {
      clickListener()({ id: 7 });
    });

    expect(tauri.callsTo("show_main_window")).toHaveLength(1);
    expect(path()).toBe("/dashboard");
  });

  it("stops listening when the shell unmounts, and ignores a click that arrives after", async () => {
    const { unregister, rendered, tauri, path } = renderListener();
    const listener = clickListener();

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(unregister).toHaveBeenCalledTimes(1);

    listener({ id: 7, data: { sessionId: "ses_42" } });
    expect(tauri.callsTo("show_main_window")).toEqual([]);
    expect(path()).toBe("/dashboard");
  });
});
