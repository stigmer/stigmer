// The handed-over chat reads on a new app's own page, in a real browser
// against the shipped stylesheet. A fresh `create-next-app` paints its body
// near-black with light text when the system is dark; the chat, mounted as
// the "In your app" handover writes it (`<AgentChat>` in its page frame,
// inside a provider that follows the system), keeps its message text at
// least 4.5:1 against what is actually painted behind it. So does a chat
// whose provider keeps the kit's default light mode on that dark page: the
// frame paints its own surface, so a dark host page never shows through
// behind the chat's dark text.
//
// The conversation view is the real thread on the finished scenario, so
// the text measured is the kit's own message text.

/// <reference types="vite/client" />
import "../../../dist/styles.css";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { commands, page } from "@vitest/browser/context";
import type { Stigmer } from "@stigmer/client";
import type { ColorMode } from "../../color-mode.js";
import { StigmerProvider } from "../../provider.js";
import { MessageThread } from "../../run/MessageThread.js";
import { SCENARIO_CLOCK, conversationOf, scenarios } from "../../test/index.js";
// The stock `create-next-app` stylesheet (`app/globals.css`, the template
// without Tailwind), as the first-hour journey's Next.js app carries it: a
// light page, and a near-black one with light text when the system is dark.
import CREATE_NEXT_APP_GLOBALS from "../../../../../test/fixtures/host-styles/create-next-app.css?raw";

declare module "@vitest/browser/context" {
  interface BrowserCommands {
    /** Emulates the system's light or dark (`vitest.a11y.config.ts`); `null` restores the browser's own. */
    emulateColorScheme: (scheme: "light" | "dark" | null) => Promise<void>;
  }
}

vi.mock("../../session/SessionViewer.js", () => ({
  SessionViewer: () => {
    const conversation = conversationOf(scenarios.finished);
    return <MessageThread turns={conversation.turns} runs={conversation.runs} contentColumn="center" />;
  },
}));

vi.mock("../../agent/useAgent.js", () => ({
  useAgent: () => ({ agent: null, isLoading: false, isRefetching: false, error: null, refetch: () => {} }),
}));

import { AgentChat } from "../AgentChat.js";

const CLIENT = {
  baseUrl: "https://example.test",
  getAuthCredential: async () => null,
  fetch: (async () => {
    throw new Error("network disabled in test");
  }) as unknown as typeof globalThis.fetch,
} as unknown as Stigmer;


/** The agent's answer and the person's message, as the finished scenario writes them. */
const MESSAGES = [/^Fourteen invoices were a cent off/, /^Audit last month's invoices for rounding errors/];

let hostStyle: HTMLStyleElement | null = null;

beforeEach(async () => {
  await page.viewport(1280, 800);
  await commands.emulateColorScheme("dark");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(SCENARIO_CLOCK));
  hostStyle = document.createElement("style");
  hostStyle.textContent = CREATE_NEXT_APP_GLOBALS;
  document.head.appendChild(hostStyle);
});

afterEach(async () => {
  cleanup();
  hostStyle?.remove();
  hostStyle = null;
  vi.useRealTimers();
  await commands.emulateColorScheme(null);
});

/** The handed-over chat, in a box with a height, on the host's page. */
function renderHandedOverChat(colorMode: ColorMode) {
  render(
    <main style={{ height: "100vh" }}>
      <StigmerProvider client={CLIENT} colorMode={colorMode}>
        <AgentChat agent="acme/variance-reporter" defaultSessionId="ses_1" />
      </StigmerProvider>
    </main>,
  );
}

/** The element whose own text starts with `pattern`. */
async function messageText(pattern: RegExp): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await vi.waitFor(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      if (pattern.test(node.textContent ?? "") && node.parentElement !== null) {
        found = node.parentElement;
        return;
      }
    }
    throw new Error(`no text matches ${pattern}`);
  });
  return found!;
}

type Rgb = readonly [number, number, number];

/**
 * What a stack of colours paints, as sRGB: each painted over the last on
 * one pixel of a canvas, so any colour syntax the browser computes
 * (`oklch(…)`, an alpha) resolves as it would on screen.
 */
function painted(layers: readonly string[]): Rgb {
  const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  context.canvas.width = 1;
  context.canvas.height = 1;
  // The page's canvas: white unless something paints over it.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 1, 1);
  for (const layer of layers) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

/** The background painted behind `element`: every ancestor's, from the root down. */
function backgroundLayers(element: HTMLElement): string[] {
  const layers: string[] = [];
  for (let at: Element | null = element; at !== null; at = at.parentElement) layers.unshift(getComputedStyle(at).backgroundColor);
  return layers;
}

/** WCAG 2 contrast ratio of two sRGB colours. */
function contrast(a: Rgb, b: Rgb): number {
  const luminance = ([r, g, b]: Rgb) => {
    const linear = (channel: number) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

describe("AgentChat on a new Next.js app's own page, the system dark", () => {
  it("is the stock page the handover lands on: near-black, with light text", () => {
    expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
    expect(painted(backgroundLayers(document.body))).toEqual([10, 10, 10]);
  });

  it.each(["system", "light"] as const)("keeps its message text readable against what is behind it (colorMode %s)", async (colorMode) => {
    renderHandedOverChat(colorMode);
    for (const pattern of MESSAGES) {
      const text = await messageText(pattern);
      const behind = backgroundLayers(text);
      const ratio = contrast(painted([...behind, getComputedStyle(text).color]), painted(behind));
      expect(ratio, `${pattern} at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
