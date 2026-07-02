import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";

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

/**
 * Regression test for #182: portaled surfaces must inherit the host's
 * full theme scope. The managed portal container (appended to
 * `document.body`, outside the provider subtree) must carry the *identical*
 * class + color mode as the in-tree container — otherwise host token
 * overrides scoped to a custom `className` never reach portaled content.
 */
describe("StigmerProvider theme scope", () => {
  it("portal container carries the identical theme scope as the in-tree container", () => {
    render(
      <StigmerProvider
        client={makeClient()}
        preset="monochrome"
        colorMode="dark"
        className="our-brand"
      >
        <div data-testid="scope-child" />
      </StigmerProvider>,
    );

    const child = document.querySelector('[data-testid="scope-child"]');
    const inTree = child?.closest(".stgm") as HTMLElement | null;
    const portal = document.body.querySelector(
      "[data-stgm-portal]",
    ) as HTMLElement | null;

    expect(inTree).not.toBeNull();
    expect(portal).not.toBeNull();

    // The invariant: both surfaces are scoped identically. Asserting
    // equality (rather than a hardcoded class string) is the truest
    // expression of the contract and won't rot if preset class names change.
    expect(portal!.className).toBe(inTree!.className);
    expect(portal!.getAttribute("data-stgm-color-mode")).toBe(
      inTree!.getAttribute("data-stgm-color-mode"),
    );

    // Spot-check the concrete pieces so a failure message is self-explanatory.
    expect(portal!.classList.contains("stgm")).toBe(true);
    expect(portal!.classList.contains("stgm-theme-monochrome")).toBe(true);
    expect(portal!.classList.contains("our-brand")).toBe(true);
    expect(portal!.getAttribute("data-stgm-color-mode")).toBe("dark");
  });

  it("portal container reflects host className updates without drift", () => {
    const client = makeClient();
    const { rerender } = render(
      <StigmerProvider client={client} colorMode="light" className="brand-a">
        <div data-testid="scope-child" />
      </StigmerProvider>,
    );

    const portal = document.body.querySelector(
      "[data-stgm-portal]",
    ) as HTMLElement;
    expect(portal.classList.contains("brand-a")).toBe(true);

    rerender(
      <StigmerProvider client={client} colorMode="dark" className="brand-b">
        <div data-testid="scope-child" />
      </StigmerProvider>,
    );

    const child = document.querySelector('[data-testid="scope-child"]');
    const inTree = child?.closest(".stgm") as HTMLElement;

    // Same node, synced — and still identical to the in-tree scope.
    expect(portal.classList.contains("brand-b")).toBe(true);
    expect(portal.classList.contains("brand-a")).toBe(false);
    expect(portal.getAttribute("data-stgm-color-mode")).toBe("dark");
    expect(portal.className).toBe(inTree.className);
  });
});
