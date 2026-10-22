// ---------------------------------------------------------------------------
// The Notifications settings route — the SDK's section over the browser
//
// The page hands the section the browser's permission request, and marks
// notifications unsupported in a browser that has none; the static export,
// rendered with no browser, reads them as supported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { NotificationsSectionProps } from "@stigmer/react-sdk";

const section = vi.hoisted(() => ({ props: [] as NotificationsSectionProps[] }));
vi.mock("@stigmer/react-sdk", () => ({
  NotificationsSection: (props: NotificationsSectionProps) => {
    section.props.push(props);
    return null;
  },
}));

import NotificationsPage from "../page";
import { requestBrowserNotificationPermission } from "@/domain/session/AttentionNotifier";

afterEach(() => {
  section.props = [];
  vi.unstubAllGlobals();
});

describe("NotificationsPage", () => {
  it("asks the browser's permission, and calls a browser with notifications supported", async () => {
    vi.stubGlobal("Notification", class {});
    render(<NotificationsPage />);
    await waitFor(() => expect(section.props.length).toBeGreaterThan(0));
    const last = section.props.at(-1);
    expect(last?.requestPermission).toBe(requestBrowserNotificationPermission);
    expect(last?.unsupported).toBe(false);
  });

  it("marks notifications unsupported in a browser without them", async () => {
    Reflect.deleteProperty(window, "Notification");
    render(<NotificationsPage />);
    await waitFor(() => expect(section.props.at(-1)?.unsupported).toBe(true));
  });

  it("renders as supported in the static export, where no browser answers", () => {
    Reflect.deleteProperty(window, "Notification");
    renderToString(<NotificationsPage />);
    expect(section.props.at(-1)?.unsupported).toBe(false);
  });
});
