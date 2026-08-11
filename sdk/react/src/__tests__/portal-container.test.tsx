import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { render, renderHook, screen, cleanup } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";
import { useStigmerPortalContainer } from "../portal-container";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "../internal/menu";

// Regression tests for stigmer-cloud#271: Base UI treats an EXPLICIT
// `container={null}` as "wait for a container" and renders the popup
// NOWHERE; only `undefined` falls back to `document.body`. The hook
// therefore returns a three-state value (undefined / null / element)
// that call sites pass straight through — see `useStigmerPortalContainer`
// for the full contract. These tests pin the contract at its single
// source plus one real consumer rendered standalone.

beforeAll(() => {
  // happy-dom lacks ResizeObserver, which Base UI positioners observe.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
});

afterEach(cleanup);

// A minimal client: the provider eagerly fetches the model/task-kind
// registries on mount. Returning a null credential keeps that work
// non-blocking (it polls for a token) so rendering is synchronous and
// never touches the network during the test.
function makeClient(): Stigmer {
  return {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

describe("useStigmerPortalContainer contract", () => {
  it("returns undefined — never null — outside a StigmerProvider", () => {
    const { result } = renderHook(() => useStigmerPortalContainer());

    // The load-bearing distinction: `undefined` makes Base UI portals
    // fall back to `document.body` (standalone components work);
    // an explicit `null` makes them render NOWHERE. A default of
    // `null` is exactly the cloud#271 defect.
    expect(result.current).toBeUndefined();
    expect(result.current).not.toBeNull();
  });

  it("returns the mounted themed portal container inside a StigmerProvider", () => {
    const { result } = renderHook(() => useStigmerPortalContainer(), {
      wrapper: ({ children }) => (
        <StigmerProvider client={makeClient()}>{children}</StigmerProvider>
      ),
    });

    // After mount the provider publishes its themed container — the
    // `data-stgm-portal` element appended to document.body.
    expect(result.current).toBeInstanceOf(HTMLElement);
    expect(result.current!.hasAttribute("data-stgm-portal")).toBe(true);
    expect(document.body.contains(result.current!)).toBe(true);
  });
});

describe("standalone portal rendering (no StigmerProvider)", () => {
  it("opens a menu into document.body instead of rendering it nowhere", async () => {
    // The internal menu wrapper is a real consumer that passes the
    // hook's value straight through as `container`. Rendered without
    // any provider, the popup must reach document.body via Base UI's
    // `undefined` fallback. Against the pre-fix hook (default `null`)
    // this popup renders nowhere and the query below times out.
    const { container } = render(
      <Menu>
        <MenuTrigger>Open actions</MenuTrigger>
        <MenuContent>
          <MenuItem>Rename</MenuItem>
        </MenuContent>
      </Menu>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open actions" }));

    const item = await screen.findByRole("menuitem", { name: "Rename" });

    // Portaled for real: in the document, but NOT inside the render
    // container — Base UI appended it to document.body.
    expect(document.body.contains(item)).toBe(true);
    expect(container.contains(item)).toBe(false);
  });
});
