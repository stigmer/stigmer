// The chat keeps a usable width in a parent that sizes to its content. The
// kit's thread and composer are size containers, which give no width of
// their own, so a chat inside a shrink-to-fit parent used to collapse to a
// few pixels: an app `create-vite` made before 9.0 lays its `body` out as
// a centered flex row, and the embedding tutorial replaces only `App.tsx`,
// so `#root` (here the test's own mount point, a child of `body` just the
// same) is a flex item with no width. The chat now takes its reading
// column's width there, capped by what the page has, and still fills a
// parent that gives it a width.

/// <reference types="vite/client" />
import "../../../dist/styles.css";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { page } from "@vitest/browser/context";
import type { Stigmer } from "@stigmer/client";
import { StigmerProvider } from "../../provider.js";
// The stylesheet `create-vite` 8.3.0 wrote into `src/index.css`.
import CREATE_VITE_8 from "../../../../../test/fixtures/host-styles/create-vite-8.3.0.css?raw";

vi.mock("../../agent/useAgent.js", () => ({
  useAgent: () => ({ agent: null, isLoading: false, isRefetching: false, error: null, refetch: () => {} }),
}));

import { AgentChat } from "../AgentChat.js";

/**
 * A service, or a method on one, whose every call fails as an unreachable
 * server's would: the chat still draws its launcher and its reply box,
 * which is all the layout under test needs.
 */
/** A call's failed answer, read as a promise or as a list's pages, and failing only when read. */
function failed(): unknown {
  const error = new Error("network disabled in test");
  return {
    then: (_resolve: unknown, reject: (reason: Error) => void) => reject(error),
    [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }),
  };
}

function failingService(): unknown {
  return new Proxy(() => {}, {
    get: (_target, prop) => (prop === "then" ? undefined : failingService()),
    apply: () => failed(),
  });
}

const CLIENT = new Proxy(
  {
    baseUrl: "https://example.test",
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  },
  { get: (target, prop, receiver) => (prop in target ? Reflect.get(target, prop, receiver) : failingService()) },
) as unknown as Stigmer;

let hostStyle: HTMLStyleElement | null = null;

beforeEach(async () => {
  await page.viewport(1280, 800);
  hostStyle = document.createElement("style");
  hostStyle.textContent = CREATE_VITE_8;
  document.head.appendChild(hostStyle);
});

afterEach(() => {
  cleanup();
  hostStyle?.remove();
  hostStyle = null;
});

/** The chat as the embedding tutorial's `App.tsx` writes it, on the page. */
function renderTutorialChat(frame?: React.CSSProperties) {
  render(
    <div style={frame}>
      <StigmerProvider client={CLIENT}>
        <AgentChat agent="acme/variance-reporter" />
      </StigmerProvider>
    </div>,
  );
}

/** The reply box: the element holding the composer's text box, its frame. */
async function replyBox(): Promise<HTMLElement> {
  let box: HTMLElement | null = null;
  await vi.waitFor(() => {
    const textbox = document.querySelector("textarea");
    if (textbox === null) throw new Error("no text box yet");
    box = textbox.closest<HTMLElement>("[class*='@container/composer']");
    if (box === null) throw new Error("no composer frame");
  });
  return box!;
}

describe("AgentChat in a parent that sizes to its content", () => {
  it("takes its reading column's width under the old create-vite body, not a few pixels", async () => {
    expect(getComputedStyle(document.body).display).toBe("flex");
    renderTutorialChat();
    const width = (await replyBox()).getBoundingClientRect().width;
    expect(width, `the reply box is ${width}px wide`).toBeGreaterThanOrEqual(600);
  });

  it("never grows past the page that holds it", async () => {
    await page.viewport(400, 800);
    renderTutorialChat();
    const box = await replyBox();
    expect(box.getBoundingClientRect().right).toBeLessThanOrEqual(400);
    expect(box.getBoundingClientRect().width).toBeGreaterThanOrEqual(300);
  });

  it("still fills a parent that gives it a width", async () => {
    renderTutorialChat({ width: 1100 });
    const chat = (await replyBox()).closest<HTMLElement>("[class~='stg:grid'][class~='stg:bg-background']");
    expect(chat).not.toBeNull();
    expect(chat?.getBoundingClientRect().width).toBe(1100);
  });
});
