// ---------------------------------------------------------------------------
// The frame of the screens before the app (connecting, the sign-in, a server
// that cannot be used) wears the person's colour scheme
//
// These screens render above the kit's provider, which is what themes the
// app, so the frame sets the scheme itself. Pinned: a chosen light or dark
// scheme is worn as chosen, "system" follows the system's appearance, and a
// webview with no media queries falls back to light.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServerScreen } from "../ServerScreen";

function systemPrefersDark(dark: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function schemeWorn(): string | null {
  render(
    <ServerScreen>
      <p>inside</p>
    </ServerScreen>,
  );
  return screen.getByText("inside").closest("[data-stgm-color-mode]")?.getAttribute("data-stgm-color-mode") ?? null;
}

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("the screens before the app", () => {
  it("wear the scheme the person chose, whatever the system's appearance", () => {
    systemPrefersDark(false);
    localStorage.setItem("stigmer:colorMode", "dark");
    expect(schemeWorn()).toBe("dark");
  });

  it("follow the system's appearance when the person chose the system's", () => {
    systemPrefersDark(true);
    localStorage.setItem("stigmer:colorMode", "system");
    expect(schemeWorn()).toBe("dark");
  });

  it("wear light when the person chose light", () => {
    systemPrefersDark(true);
    localStorage.setItem("stigmer:colorMode", "light");
    expect(schemeWorn()).toBe("light");
  });

  it("wear light when the webview cannot say the system's appearance", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(schemeWorn()).toBe("light");
  });
});
