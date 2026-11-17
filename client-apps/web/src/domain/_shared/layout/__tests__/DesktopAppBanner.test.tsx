// ---------------------------------------------------------------------------
// The Stigmer Desktop banner: its two acts, and when the shell draws it
//
// The banner says in plain words what Stigmer Desktop is for ("Stigmer
// Desktop: run agents on your own computer.") and offers exactly two acts:
// "Download" starts the desktop download, and the "Dismiss" icon button hands
// control back to the shell's dismiss handler (which records the
// campaign-scoped dismissal). The download itself is lib/desktop-download's, pinned by its
// own suite; here it is stubbed so the click is observable.
//
// The shell's banner (`ShellDesktopBanner`) decides whether to draw it
// (stigmer#3194): never on the first signed-in screen of this browser, which
// seeds the first-seen key; never while the organization's onboarding
// journey has a step to take or is still being read; and, only once every
// other rule would show it, never when the release has no installer for this
// platform. Storage that refuses every read and write hides the banner and
// breaks nothing. The organization and its journey are stubbed; the
// journey's own read is pinned in the kit's suite.
// ---------------------------------------------------------------------------

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseJourneyReturn } from "@stigmer/react-sdk";
import { DISMISSED_KEY, FIRST_SEEN_KEY } from "@/lib/desktop-keys";
import { DesktopAppBanner } from "../DesktopAppBanner";

const download = vi.hoisted(() => ({
  trigger: vi.fn<() => Promise<void>>(),
  hasInstaller: vi.fn<() => Promise<boolean>>(),
}));

vi.mock("@/lib/desktop-download", () => ({
  triggerDesktopDownload: download.trigger,
  hasDesktopInstaller: download.hasInstaller,
}));

const kit = vi.hoisted(() => ({
  org: "org_1",
  journey: undefined as UseJourneyReturn | undefined,
  journeyAsked: [] as Array<{
    org: string | null | undefined;
    enabled: boolean;
  }>,
}));

vi.mock("@stigmer/react-sdk", async () => {
  const actual =
    await vi.importActual<typeof import("@stigmer/react-sdk")>(
      "@stigmer/react-sdk",
    );
  return {
    IconButton: actual.IconButton,
    useActiveOrgId: () => kit.org,
    useJourney: (
      org: string | null | undefined,
      options: { readonly enabled: boolean },
    ): UseJourneyReturn => {
      kit.journeyAsked.push({ org, enabled: options.enabled });
      if (kit.journey === undefined) throw new Error("the test set no journey");
      return kit.journey;
    },
  };
});

const STEP = {
  id: "describe",
  number: 1,
  title: "Say what it should do",
  state: "current",
  line: "Pick an example job.",
} as const;

const JOURNEY: Record<"open" | "pending" | "done" | "off", UseJourneyReturn> = {
  open: {
    status: "ready",
    steps: [STEP],
    done: 0,
    current: STEP,
    agent: undefined,
    everRan: false,
  },
  pending: {
    status: "pending",
    steps: [],
    done: 0,
    current: undefined,
    agent: undefined,
    everRan: undefined,
  },
  done: {
    status: "ready",
    steps: [{ ...STEP, state: "done" }],
    done: 6,
    current: undefined,
    agent: undefined,
    everRan: true,
  },
  off: {
    status: "off",
    steps: [],
    done: 0,
    current: undefined,
    agent: undefined,
    everRan: undefined,
  },
};

// The module remembers that it seeded the first-seen key on this page load;
// each test takes a fresh copy, as a new page load would.
async function loadShellBanner() {
  vi.resetModules();
  const { ShellDesktopBanner } = await import("../DesktopAppBanner");
  return ShellDesktopBanner;
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  download.trigger.mockReset();
  download.hasInstaller.mockReset();
  download.hasInstaller.mockResolvedValue(true);
  kit.org = "org_1";
  kit.journey = JOURNEY.done;
  kit.journeyAsked.length = 0;
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DesktopAppBanner", () => {
  it("says what Stigmer Desktop is for and starts the download on Download", () => {
    const onDismiss = vi.fn();
    render(<DesktopAppBanner onDismiss={onDismiss} />);

    const banner = screen.getByRole("complementary", { name: "Desktop app" });
    // Plain words, no "runners": what the app is for (stigmer#3194).
    expect(banner.querySelector("p")?.textContent).toBe(
      "Stigmer Desktop: run agents on your own computer.",
    );
    expect(banner.querySelector("p span")?.textContent).toBe(
      "Stigmer Desktop:",
    );

    fireEvent.click(screen.getByRole("button", { name: /Download/ }));

    expect(download.trigger).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("hands Dismiss to the shell's dismiss handler without downloading", () => {
    const onDismiss = vi.fn();
    render(<DesktopAppBanner onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(download.trigger).not.toHaveBeenCalled();
  });
});

describe("ShellDesktopBanner", () => {
  it("seeds the first-seen key on the first signed-in screen and stays hidden there", async () => {
    const ShellDesktopBanner = await loadShellBanner();

    render(<ShellDesktopBanner />);
    await flush();

    expect(localStorage.getItem(FIRST_SEEN_KEY)).not.toBeNull();
    expect(
      screen.queryByRole("complementary", { name: "Desktop app" }),
    ).toBeNull();
    expect(download.hasInstaller).not.toHaveBeenCalled();
  });

  it("reads the active organization's journey", async () => {
    const ShellDesktopBanner = await loadShellBanner();

    render(<ShellDesktopBanner />);

    expect(kit.journeyAsked.at(-1)).toEqual({ org: "org_1", enabled: true });
  });

  it.each([
    ["has a step to take", JOURNEY.open],
    ["is still being read", JOURNEY.pending],
  ])(
    "stays hidden on a later visit while the journey %s, and asks for no installer",
    async (_label, journey) => {
      localStorage.setItem(FIRST_SEEN_KEY, "2026-11-01T00:00:00.000Z");
      kit.journey = journey;
      const ShellDesktopBanner = await loadShellBanner();

      render(<ShellDesktopBanner />);
      await flush();

      expect(
        screen.queryByRole("complementary", { name: "Desktop app" }),
      ).toBeNull();
      expect(download.hasInstaller).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["done", JOURNEY.done],
    ["off", JOURNEY.off],
  ])(
    "shows on a later visit once the journey is %s and the platform has an installer",
    async (_label, journey) => {
      localStorage.setItem(FIRST_SEEN_KEY, "2026-11-01T00:00:00.000Z");
      kit.journey = journey;
      const ShellDesktopBanner = await loadShellBanner();

      render(<ShellDesktopBanner />);

      expect(
        await screen.findByRole("complementary", { name: "Desktop app" }),
      ).toBeTruthy();
      expect(download.hasInstaller).toHaveBeenCalledTimes(1);
    },
  );

  it("shows once the journey closes, without a reload", async () => {
    localStorage.setItem(FIRST_SEEN_KEY, "2026-11-01T00:00:00.000Z");
    kit.journey = JOURNEY.open;
    const ShellDesktopBanner = await loadShellBanner();

    const { rerender } = render(<ShellDesktopBanner />);
    await flush();
    expect(
      screen.queryByRole("complementary", { name: "Desktop app" }),
    ).toBeNull();

    kit.journey = JOURNEY.done;
    rerender(<ShellDesktopBanner />);

    expect(
      await screen.findByRole("complementary", { name: "Desktop app" }),
    ).toBeTruthy();
  });

  it("stays hidden when the release has no installer for this platform", async () => {
    localStorage.setItem(FIRST_SEEN_KEY, "2026-11-01T00:00:00.000Z");
    download.hasInstaller.mockResolvedValue(false);
    const ShellDesktopBanner = await loadShellBanner();

    render(<ShellDesktopBanner />);
    await waitFor(() => expect(download.hasInstaller).toHaveBeenCalledTimes(1));
    await flush();

    expect(
      screen.queryByRole("complementary", { name: "Desktop app" }),
    ).toBeNull();
  });

  it("hides on Dismiss and records the campaign", async () => {
    localStorage.setItem(FIRST_SEEN_KEY, "2026-11-01T00:00:00.000Z");
    const ShellDesktopBanner = await loadShellBanner();

    render(<ShellDesktopBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Desktop app" }),
      ).toBeNull(),
    );
    expect(localStorage.getItem(DISMISSED_KEY)).toContain("campaign");
  });

  it("renders nothing, and breaks nothing around it, when storage refuses every read and write", async () => {
    const refuse = () => {
      throw new DOMException("storage is blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: refuse,
      setItem: refuse,
      removeItem: refuse,
      clear: refuse,
      key: refuse,
      length: 0,
    });
    const ShellDesktopBanner = await loadShellBanner();

    render(
      <div>
        <ShellDesktopBanner />
        <p>page content</p>
      </div>,
    );
    await flush();

    expect(screen.getByText("page content")).toBeTruthy();
    expect(
      screen.queryByRole("complementary", { name: "Desktop app" }),
    ).toBeNull();
    expect(download.hasInstaller).not.toHaveBeenCalled();
  });
});
