/**
 * Every beat of the two plugin demos (the marketplace connect tour, the
 * OAuth connect flow), drawn by the real `PluginDetailView` over the
 * scenario's own preview fixtures.
 *
 * The player is the one stand-in: a docs reader steps through the beats
 * with Scenar's timed player, and here a beat is pinned and drawn directly,
 * its step-change callback fired the way the player fires it. The preview
 * provider's network seam is the other: the real provider chain
 * (`PreviewProviders`) is kept, and its fetches are answered by the
 * fixtures the scenario handed its preview provider, as MSW answers them on
 * the docs page.
 *
 * Pins, for the OAuth flow: the page opens "Not signed in" with its Sign in
 * button tagged for the cursor; the authorization beat draws GitHub's page;
 * the last beat reads My vault again, now holding the login, says "Signed
 * in", and presses the real "Check tools", whose tools listing appears. For
 * the marketplace tour: the grid beats draw the Plugins grid; the detail
 * beats tag "Check tools" without pressing it; and the tools beat presses
 * it, so the server's tools appear.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, type ReactNode, useEffect } from "react";
import { getResponse, type HttpHandler } from "msw";
import type { ScenarioStep } from "@scenar/core";

import { OAuthConnectFlow } from "../oauth-connect-flow/index";
import { MarketplaceConnectTour } from "../marketplace-connect-tour/index";
import { GITHUB_TOOLS } from "../oauth-connect-flow/steps";
import { NEON_TOOLS } from "../marketplace-connect-tour/steps";

/** The beat the stand-in player draws, and the fixtures the last mount handed over. */
const playback: { beat: number; fixtures: readonly HttpHandler[] } = { beat: 0, fixtures: [] };

vi.mock("@scenar/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@scenar/react")>();
  function PinnedBeatPlayer<T>(props: {
    readonly steps?: ScenarioStep<T>[];
    readonly children: (data: T, stepIndex: number) => ReactNode;
    readonly onStepChange?: (data: T, index: number) => void;
  }) {
    const { steps, children, onStepChange } = props;
    const step = steps?.[playback.beat];
    if (step === undefined) throw new Error(`the scenario has no beat ${playback.beat}`);
    useEffect(() => {
      onStepChange?.(step.data, playback.beat);
    }, [onStepChange, step]);
    return <div data-demo-step={playback.beat}>{children(step.data, playback.beat)}</div>;
  }
  return { ...actual, ScenarioPlayer: PinnedBeatPlayer };
});

vi.mock("../../shared/StigmerPreviewProvider", async () => {
  const { PreviewProviders } = await import("../../../../../../.scenar/providers");
  function FixtureAnsweredProvider(props: ComponentProps<typeof import("../../shared/StigmerPreviewProvider").StigmerPreviewProvider>) {
    playback.fixtures = props.fixtures ?? [];
    return <PreviewProviders>{props.children}</PreviewProviders>;
  }
  return { StigmerPreviewProvider: FixtureAnsweredProvider };
});

/** Answers a fetch the way the scenario's MSW fixtures do; anything else is a 404. */
async function answerFromFixtures(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const request = new Request(new URL(url, "https://docs.example/"), input instanceof Request ? input : init);
  const response = await getResponse([...playback.fixtures], request);
  return response ?? new Response(null, { status: 404 });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(answerFromFixtures));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  playback.beat = 0;
  playback.fixtures = [];
});

function showBeat(Scenario: () => ReactNode, beat: number) {
  playback.beat = beat;
  return render(<Scenario />);
}

/** The button carrying a cursor target, once the page has drawn it. */
async function cursorTarget(target: string): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>(`[data-cursor-target="${target}"]`);
    if (element === null) throw new Error(`nothing is tagged ${target} yet`);
    return element;
  });
}

describe("the OAuth connect flow, beat by beat", () => {
  it.each([0, 1])("beat %i shows the server not signed in, its Sign in button tagged for the cursor", async (beat) => {
    showBeat(OAuthConnectFlow, beat);
    const signIn = await cursorTarget("sign-in-button");
    expect(signIn.getAttribute("aria-label")).toBe("Sign in to github");
    expect(screen.getByText("Not signed in")).toBeTruthy();
    expect(screen.queryByText(GITHUB_TOOLS.tools[0]!.name)).toBeNull();
  });

  it("beat 2 draws GitHub's authorization page", async () => {
    showBeat(OAuthConnectFlow, 2);
    expect(await screen.findByText("Authorize Stigmer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Authorize stigmer" })).toBeTruthy();
    expect(screen.getByText("Repositories")).toBeTruthy();
  });

  it("beat 3 reads the login from My vault and presses Check tools, listing the server's tools", async () => {
    showBeat(OAuthConnectFlow, 3);
    const check = await cursorTarget("check-tools");
    expect(check.textContent).toMatch(/Check tools|Checking/);
    for (const tool of GITHUB_TOOLS.tools) {
      expect(await screen.findByText(tool.name)).toBeTruthy();
    }
    expect(screen.queryByText("Not signed in")).toBeNull();
  });
});

describe("the marketplace connect tour, beat by beat", () => {
  it.each([0, 1])("beat %i draws the Plugins grid", async (beat) => {
    showBeat(MarketplaceConnectTour, beat);
    expect(await screen.findByText("Plugins")).toBeTruthy();
    expect(screen.getByText("Neon")).toBeTruthy();
  });

  it.each([2, 3])("beat %i tags Check tools for the cursor without pressing it", async (beat) => {
    showBeat(MarketplaceConnectTour, beat);
    await cursorTarget("check-tools");
    expect(screen.queryByText(NEON_TOOLS.tools[0]!.name)).toBeNull();
  });

  it("beat 4 presses Check tools, so the server's tools appear", async () => {
    showBeat(MarketplaceConnectTour, 4);
    await cursorTarget("check-tools");
    for (const tool of NEON_TOOLS.tools) {
      expect(await screen.findByText(tool.name)).toBeTruthy();
    }
  });
});
