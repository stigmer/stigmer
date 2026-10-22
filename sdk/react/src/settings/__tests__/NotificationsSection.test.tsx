/**
 * Pins NotificationsSection and the setting it writes
 * (../../session/attentionNotificationsSetting.ts):
 *
 *   - off until the person turns it on; turning it on asks the host's
 *     permission first and records the choice only when it is allowed;
 *   - a refusal leaves it off and says where to allow notifications;
 *   - turning it off asks nothing and records off;
 *   - a host that cannot show notifications renders it off and disabled;
 *   - the choice is kept in this browser and read back by every reader.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { NotificationsSection } from "../NotificationsSection";
import {
  ATTENTION_NOTIFICATIONS_KEY,
  useAttentionNotificationsSetting,
} from "../../session/attentionNotificationsSetting";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function theSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: "Tell me when a conversation needs me" });
}

describe("NotificationsSection", () => {
  it("is off until turned on, and turning it on asks the permission before recording the choice", async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    render(<NotificationsSection requestPermission={requestPermission} />);
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect(requestPermission).not.toHaveBeenCalled();

    act(() => theSwitch().click());
    await waitFor(() => expect(theSwitch().getAttribute("aria-checked")).toBe("true"));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(ATTENTION_NOTIFICATIONS_KEY)).toBe("true");
  });

  it("stays off when the permission is refused, and says where to allow it", async () => {
    render(<NotificationsSection requestPermission={vi.fn().mockResolvedValue(false)} />);
    act(() => theSwitch().click());
    expect((await screen.findByRole("alert")).textContent).toContain("Notifications are blocked");
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect(localStorage.getItem(ATTENTION_NOTIFICATIONS_KEY)).toBe("false");
  });

  it("turns off without asking", () => {
    localStorage.setItem(ATTENTION_NOTIFICATIONS_KEY, "true");
    const requestPermission = vi.fn();
    render(<NotificationsSection requestPermission={requestPermission} />);
    expect(theSwitch().getAttribute("aria-checked")).toBe("true");
    act(() => theSwitch().click());
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("renders off and disabled where notifications cannot be shown", () => {
    localStorage.setItem(ATTENTION_NOTIFICATIONS_KEY, "true");
    render(<NotificationsSection requestPermission={vi.fn()} unsupported />);
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
    expect((theSwitch() as HTMLButtonElement).disabled).toBe(true);
    screen.getByText("This browser cannot show notifications.");
  });
});

describe("useAttentionNotificationsSetting", () => {
  it("reads off where storage refuses, and off when rendered on a server", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useAttentionNotificationsSetting());
    expect(result.current.on).toBe(false);
    getItem.mockRestore();

    localStorage.setItem(ATTENTION_NOTIFICATIONS_KEY, "true");
    function Reader() {
      return <span>{String(useAttentionNotificationsSetting().on)}</span>;
    }
    expect(renderToString(<Reader />)).toContain("false");
  });


  it("reads every change back, in each reader", () => {
    const first = renderHook(() => useAttentionNotificationsSetting());
    const second = renderHook(() => useAttentionNotificationsSetting());
    expect(first.result.current.on).toBe(false);
    act(() => first.result.current.set(true));
    expect(second.result.current.on).toBe(true);
    act(() => second.result.current.set(false));
    expect(first.result.current.on).toBe(false);
  });
});
