/**
 * Pins the console's attention notifier (../AttentionNotifier.tsx): it follows
 * the active organization once the person turned notifications on and the
 * browser can show them, shows each notice as a browser notification only
 * while the browser allows it, opens the conversation when one is clicked,
 * and holds back the notice for the conversation open in a visible tab. The
 * permission is asked only when the setting is flipped, and a refusal reads
 * as not allowed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import type { UseAttentionNotificationsOptions } from "@stigmer/react-sdk";

const host = vi.hoisted(() => ({
  options: [] as UseAttentionNotificationsOptions[],
  on: true,
  activeSessionId: null as string | null,
  opened: [] as string[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  useOrg: () => ({ activeOrg: { metadata: { id: "org_acme" } } }),
  useAttentionNotificationsSetting: () => ({ on: host.on, set: vi.fn() }),
  useAttentionNotifications: (options: UseAttentionNotificationsOptions) => host.options.push(options),
}));

vi.mock("../session-navigation", () => ({
  useSessionNavigation: () => ({
    activeSessionId: host.activeSessionId,
    navigateToSession: (id: string) => host.opened.push(id),
  }),
}));

import { AttentionNotifier, requestBrowserNotificationPermission } from "../AttentionNotifier";

/** A browser `Notification` that records what was shown. */
class FakeNotification {
  static permission: NotificationPermission = "granted";
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  static shown: FakeNotification[] = [];
  onclick: (() => void) | null = null;
  closed = false;
  constructor(
    readonly title: string,
    readonly options: NotificationOptions,
  ) {
    FakeNotification.shown.push(this);
  }
  close() {
    this.closed = true;
  }
}

function lastOptions(): UseAttentionNotificationsOptions {
  const options = host.options.at(-1);
  if (!options) throw new Error("the notifier never followed attention");
  return options;
}

const finished = { id: "a", sessionId: "s1", title: "Migrate the database", body: "Finished", reason: "finished" } as const;

beforeEach(() => {
  host.options = [];
  host.on = true;
  host.activeSessionId = null;
  host.opened = [];
  FakeNotification.permission = "granted";
  FakeNotification.shown = [];
  FakeNotification.requestPermission.mockReset();
  vi.stubGlobal("Notification", FakeNotification);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AttentionNotifier", () => {
  it("follows the active organization while the setting is on", () => {
    render(<AttentionNotifier />);
    expect(lastOptions().org).toBe("org_acme");
    expect(lastOptions().enabled).toBe(true);
  });

  it("follows nothing while the setting is off", () => {
    host.on = false;
    render(<AttentionNotifier />);
    expect(lastOptions().enabled).toBe(false);
  });

  it("shows a notice as a browser notification that opens its conversation when clicked", () => {
    const focus = vi.spyOn(window, "focus").mockImplementation(() => undefined);
    render(<AttentionNotifier />);
    lastOptions().notify(finished);
    const [shown] = FakeNotification.shown;
    expect(shown?.title).toBe("Migrate the database");
    expect(shown?.options).toEqual({ body: "Finished", tag: "a" });
    shown?.onclick?.();
    expect(host.opened).toEqual(["s1"]);
    expect(shown?.closed).toBe(true);
    focus.mockRestore();
  });

  it("shows nothing once the browser no longer allows notifications", () => {
    FakeNotification.permission = "denied";
    render(<AttentionNotifier />);
    lastOptions().notify(finished);
    expect(FakeNotification.shown).toHaveLength(0);
  });

  it("holds back the notice for the conversation open in a visible tab, and only that one", () => {
    host.activeSessionId = "s1";
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    render(<AttentionNotifier />);
    const { isShowing } = lastOptions();
    expect(isShowing?.("s1")).toBe(true);
    expect(isShowing?.("s2")).toBe(false);
    visibility.mockReturnValue("hidden");
    expect(isShowing?.("s1"), "a tab in the background shows nothing").toBe(false);
    visibility.mockRestore();
  });
});

describe("requestBrowserNotificationPermission", () => {
  it("asks nothing when the browser already allows notifications", async () => {
    await expect(requestBrowserNotificationPermission()).resolves.toBe(true);
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
  });

  it("asks the browser, and reads a refusal as not allowed", async () => {
    FakeNotification.permission = "default";
    FakeNotification.requestPermission.mockResolvedValueOnce("granted");
    await expect(requestBrowserNotificationPermission()).resolves.toBe(true);
    FakeNotification.requestPermission.mockResolvedValueOnce("denied");
    await expect(requestBrowserNotificationPermission()).resolves.toBe(false);
  });

  it("allows nothing in a browser with no notifications", async () => {
    vi.stubGlobal("Notification", undefined);
    // `"Notification" in window` is what a browser without them fails.
    Reflect.deleteProperty(window, "Notification");
    await expect(requestBrowserNotificationPermission()).resolves.toBe(false);
  });
});
