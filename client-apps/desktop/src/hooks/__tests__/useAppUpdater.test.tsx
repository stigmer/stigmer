// ---------------------------------------------------------------------------
// useAppUpdater — the desktop finds, offers and installs its own updates
//
// Run over Tauri's IPC mock, so the real updater and process plugins send
// their real commands (`plugin:updater|check`,
// `plugin:updater|download_and_install`, `plugin:process|restart`). Pinned:
//
//   - the schedule: the first check five seconds after mount, then every
//     four hours, and one on the tray's "Check for Updates" event;
//   - quiet background checks: a background check that finds nothing, or
//     fails, says nothing; a check the person asked for always answers;
//   - an update is offered, never forced: it installs only from the toast's
//     "Restart to Update" action, and the app relaunches only once the
//     install has succeeded;
//   - a check already in flight is not started twice.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, render, screen } from "@testing-library/react";
import { mockTauri, type TauriMock } from "../../__test-utils__/tauri";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

import { useAppUpdater } from "../useAppUpdater";
import { AppUpdaterProvider, useAppUpdaterContext } from "../AppUpdaterContext";

const SECOND = 1_000;
const HOUR = 60 * 60 * SECOND;

const UPDATE = {
  rid: 7,
  currentVersion: "1.4.0",
  version: "1.5.0",
  date: "2026-09-30",
  body: "notes",
  rawJson: {},
};

type CheckAnswer = typeof UPDATE | null | Error;

function updaterHost(answer: () => CheckAnswer): TauriMock {
  return mockTauri({
    "plugin:updater|check": () => {
      const value = answer();
      if (value instanceof Error) throw value;
      return value;
    },
    "plugin:updater|download_and_install": () => null,
    "plugin:process|restart": () => null,
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** The "Restart to Update" action of the last update toast. */
function restartAction(): () => void {
  const options = toast.info.mock.calls.at(-1)?.[1] as {
    action: { label: string; onClick: () => void };
  };
  expect(options.action.label).toBe("Restart to Update");
  return options.action.onClick;
}

describe("useAppUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const fn of Object.values(toast)) fn.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("checks first five seconds after mount, then every four hours", async () => {
    const tauri = updaterHost(() => null);
    renderHook(() => useAppUpdater());

    await advance(5 * SECOND - 1);
    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(0);
    await advance(1);
    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(1);

    await advance(4 * HOUR);
    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(2);
  });

  it("stops checking once unmounted", async () => {
    const tauri = updaterHost(() => null);
    const { unmount } = renderHook(() => useAppUpdater());
    unmount();

    await advance(5 * HOUR);
    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(0);
  });

  it("says nothing when a background check finds no update or fails", async () => {
    let answer: CheckAnswer = null;
    updaterHost(() => answer);
    const { result } = renderHook(() => useAppUpdater());

    await advance(5 * SECOND);
    expect(result.current.status).toBe("idle");

    answer = new Error("offline");
    await advance(4 * HOUR);
    expect(result.current.status).toBe("error");
    expect(Object.values(toast).every((fn) => fn.mock.calls.length === 0)).toBe(
      true,
    );
  });

  it("answers a check the person asked for, whether or not there is an update", async () => {
    let answer: CheckAnswer = null;
    updaterHost(() => answer);
    const { result } = renderHook(() => useAppUpdater());

    await act(() => result.current.checkForUpdate());
    expect(toast.success).toHaveBeenCalledWith(
      "You're on the latest version.",
      {
        id: "app-update",
      },
    );

    answer = new Error("offline");
    await act(() => result.current.checkForUpdate());
    expect(toast.error).toHaveBeenCalledWith(
      "Could not check for updates. Try again later.",
      { id: "app-update" },
    );
  });

  it("checks when the tray asks, and answers like a check the person asked for", async () => {
    const tauri = updaterHost(() => null);
    renderHook(() => useAppUpdater());
    await advance(0);

    await act(() => tauri.emit("check-for-update"));
    await advance(0);

    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledWith(
      "You're on the latest version.",
      {
        id: "app-update",
      },
    );
  });

  it("offers a found update without installing it", async () => {
    const tauri = updaterHost(() => UPDATE);
    const { result } = renderHook(() => useAppUpdater());

    await advance(5 * SECOND);

    expect(result.current.status).toBe("available");
    expect(result.current.availableVersion).toBe("1.5.0");
    expect(toast.info).toHaveBeenCalledWith(
      "Update available: v1.5.0",
      expect.objectContaining({ id: "app-update", duration: Infinity }),
    );
    expect(tauri.callsTo("plugin:updater|download_and_install")).toEqual([]);
    expect(tauri.callsTo("plugin:process|restart")).toEqual([]);
  });

  it("installs the offered update and then relaunches, from the toast's action only", async () => {
    const tauri = updaterHost(() => UPDATE);
    const { result } = renderHook(() => useAppUpdater());
    await advance(5 * SECOND);

    await act(async () => {
      restartAction()();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(tauri.callsTo("plugin:updater|download_and_install")).toEqual([
      expect.objectContaining({ rid: UPDATE.rid }),
    ]);
    const order = tauri.calls
      .map((call) => call.cmd)
      .filter((cmd) => cmd !== "plugin:updater|check");
    expect(order).toEqual([
      "plugin:updater|download_and_install",
      "plugin:process|restart",
    ]);
    expect(result.current.status).toBe("ready");
  });

  it("does not relaunch when the install fails, and says so", async () => {
    const tauri = updaterHost(() => UPDATE);
    tauri.handle({
      "plugin:updater|download_and_install": () => {
        throw new Error("signature mismatch");
      },
    });
    const { result } = renderHook(() => useAppUpdater());
    await advance(5 * SECOND);

    await act(async () => {
      restartAction()();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(tauri.callsTo("plugin:process|restart")).toEqual([]);
    expect(result.current.status).toBe("error");
    expect(toast.error).toHaveBeenCalledWith(
      "Update failed. Please try again later.",
      { id: "app-update" },
    );
  });

  it("does not start a second check while one is in flight", async () => {
    let release: (value: null) => void = () => {};
    const tauri = mockTauri({
      "plugin:updater|check": () =>
        new Promise<null>((resolve) => {
          release = resolve;
        }),
    });
    const { result } = renderHook(() => useAppUpdater());

    await act(async () => {
      void result.current.checkForUpdate();
      void result.current.checkForUpdate();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(tauri.callsTo("plugin:updater|check")).toHaveLength(1);
    expect(result.current.status).toBe("checking");

    await act(async () => {
      release(null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.status).toBe("idle");
  });
});

describe("AppUpdaterProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one updater with its descendants", () => {
    updaterHost(() => null);
    function Status() {
      return <p>status={useAppUpdaterContext().status}</p>;
    }
    render(
      <AppUpdaterProvider>
        <Status />
      </AppUpdaterProvider>,
    );
    expect(screen.getByText("status=idle")).toBeTruthy();
  });

  it("refuses a reader outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useAppUpdaterContext())).toThrow(
      "useAppUpdaterContext must be used within <AppUpdaterProvider>",
    );
    spy.mockRestore();
  });
});
