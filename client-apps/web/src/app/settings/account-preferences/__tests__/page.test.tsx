// ---------------------------------------------------------------------------
// The Account preferences settings route — the SDK's section over the browser
//
// The page hands the section the browser's permission request for its
// Notifications section, and marks notifications unsupported in a browser
// that has none; the static export, rendered with no browser, reads them as
// supported.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { AccountPreferencesSectionProps } from "@stigmer/react-sdk/console";

const section = vi.hoisted(() => ({
  props: [] as AccountPreferencesSectionProps[],
}));
vi.mock("@stigmer/react-sdk/console", () => ({
  AccountPreferencesSection: (props: AccountPreferencesSectionProps) => {
    section.props.push(props);
    return null;
  },
}));

import AccountPreferencesPage from "../page";
import { requestBrowserNotificationPermission } from "@/domain/session/AttentionNotifier";

afterEach(() => {
  section.props = [];
  vi.unstubAllGlobals();
});

describe("AccountPreferencesPage", () => {
  it("asks the browser's permission, and calls a browser with notifications supported", async () => {
    vi.stubGlobal("Notification", class {});
    render(<AccountPreferencesPage />);
    await waitFor(() => expect(section.props.length).toBeGreaterThan(0));
    const last = section.props.at(-1);
    expect(last?.requestPermission).toBe(requestBrowserNotificationPermission);
    expect(last?.unsupported).toBe(false);
  });

  it("marks notifications unsupported in a browser without them", async () => {
    Reflect.deleteProperty(window, "Notification");
    render(<AccountPreferencesPage />);
    await waitFor(() => expect(section.props.at(-1)?.unsupported).toBe(true));
  });

  it("renders as supported in the static export, where no browser answers", () => {
    Reflect.deleteProperty(window, "Notification");
    renderToString(<AccountPreferencesPage />);
    expect(section.props.at(-1)?.unsupported).toBe(false);
  });
});
