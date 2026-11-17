/**
 * Proves `colorMode="system"` follows the OS without breaking a
 * server-rendered page: the server writes the light scope (it cannot see the
 * OS), hydration starts from the same, and the client then moves the in-tree
 * scope and the portal container to the OS's dark mode, with no hydration
 * error; a client-only mount starts in the OS's mode at once; and an OS change
 * is followed (stigmer#3202).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../provider";

// A minimal client: a null credential keeps the provider's registry read
// waiting, off the network.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

/** A system in `dark` (or light), whose change listeners can be told it moved. */
function systemScheme(dark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const state = { dark };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query === "(prefers-color-scheme: dark)" && state.dark;
      },
      media: query,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    })),
  );
  return {
    set(next: boolean) {
      state.dark = next;
      for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
    },
  };
}

function tree() {
  return (
    <StigmerProvider client={makeClient()} colorMode="system">
      <p data-testid="child">Fourteen invoices were a cent off.</p>
    </StigmerProvider>
  );
}

const scopeOf = (root: ParentNode) => root.querySelector("[data-testid=child]")?.closest("[data-stgm-color-mode]");
const portal = () => document.body.querySelector("[data-stgm-portal]");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe('StigmerProvider colorMode="system"', () => {
  it("hydrates a server-rendered page without a mismatch, then follows a dark OS", async () => {
    systemScheme(true);
    const html = renderToString(tree());
    expect(html).toContain('data-stgm-color-mode="light"');

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const recoverable = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await act(async () => {
        hydrateRoot(container, tree(), { onRecoverableError: recoverable });
      });
      expect(scopeOf(container)?.getAttribute("data-stgm-color-mode")).toBe("dark");
      expect(portal()?.getAttribute("data-stgm-color-mode")).toBe("dark");
      expect(recoverable).not.toHaveBeenCalled();
      expect(consoleError.mock.calls.filter(([message]) => /hydrat/i.test(String(message)))).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("starts in the OS's mode on a client-only mount, and follows a change", () => {
    const os = systemScheme(true);
    const { container } = render(tree());
    expect(scopeOf(container)?.getAttribute("data-stgm-color-mode")).toBe("dark");

    act(() => os.set(false));
    expect(scopeOf(container)?.getAttribute("data-stgm-color-mode")).toBe("light");
  });
});
