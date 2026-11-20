/**
 * `<ThemePlayground>`: the chat panel demo framed in the default look, the
 * six presets, light or dark and a radius as controls, each change posted to
 * the frame from the page's own origin (and again when the frame says it
 * listens), native radios to pick with, and the code beside it following
 * the pick, highlighted and keyboard-scrollable as the docs' own code blocks
 * are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { THEME_PRESETS } from "@stigmer/design-tokens";
import { LIVE_CAPTION, LIVE_READY_MESSAGE, LIVE_THEME_MESSAGE } from "@/lib/live";
import { CODE_HIGHLIGHT } from "@/lib/code-highlight";
import { SCROLL_REGION } from "@/lib/scroll-region";
import { ThemePlayground } from "../ThemePlayground";

/** The props each code block was last drawn with, by its title. */
const drawnBlocks = new Map<string | undefined, { options?: unknown; codeblock?: { title?: string; viewportProps?: unknown } }>();

vi.mock("fumadocs-ui/components/dynamic-codeblock", () => ({
  DynamicCodeBlock: (props: { code: string; options?: unknown; codeblock?: { title?: string; viewportProps?: unknown } }) => {
    drawnBlocks.set(props.codeblock?.title, props);
    return <pre data-title={props.codeblock?.title}>{props.code}</pre>;
  },
}));

afterEach(() => {
  cleanup();
  drawnBlocks.clear();
});

/** The playground drawn, its frame's window replaced by one that records what it is posted. */
function draw() {
  const view = render(<ThemePlayground />);
  const frame = view.container.querySelector("iframe")!;
  const postMessage = vi.fn();
  Object.defineProperty(frame, "contentWindow", { value: { postMessage }, configurable: true });
  return { view, frame, postMessage };
}

describe("ThemePlayground", () => {
  it("frames the chat panel in the default look, lazily, with the replay caption and the default code", () => {
    const { frame } = draw();
    expect(frame.getAttribute("src")).toBe("/gallery/?scene=agent-chat-panel&mode=dark&embed=1");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(screen.getByText(LIVE_CAPTION)).toBeTruthy();
    expect(screen.getAllByRole("radio", { checked: true }).map((radio) => (radio as HTMLInputElement).value)).toEqual(["default", "dark"]);
    expect(document.querySelector('pre[data-title="Themed.tsx"]')!.textContent).toContain('<StigmerProvider client={client} colorMode="dark">');
    expect(document.querySelector('pre[data-title="my-theme.css"]')).toBeNull();
  });

  it("offers every preset", () => {
    draw();
    for (const preset of THEME_PRESETS) expect(screen.getByRole("radio", { name: new RegExp(`^${preset.name}`) })).toBeTruthy();
  });

  it("posts each change to the frame from its own origin, and the code follows", () => {
    const { postMessage } = draw();
    fireEvent.click(screen.getByRole("radio", { name: /^Friendly/ }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: LIVE_THEME_MESSAGE, preset: "friendly", mode: "dark", radius: null }, window.location.origin);
    fireEvent.click(screen.getByRole("radio", { name: "light" }));
    expect(postMessage).toHaveBeenLastCalledWith({ type: LIVE_THEME_MESSAGE, preset: "friendly", mode: "light", radius: null }, window.location.origin);
    expect(document.querySelector('pre[data-title="Themed.tsx"]')!.textContent).toContain('preset="friendly" colorMode="light"');
  });

  it("writes a radius off the preset's own as its own stylesheet, and takes it back", () => {
    const { postMessage } = draw();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.75" } });
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ radius: 0.75 }), window.location.origin);
    expect(document.querySelector('pre[data-title="my-theme.css"]')!.textContent).toContain("--stgm-radius: 0.75rem;");
    expect(screen.getByText("0.75rem")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use the preset’s radius" }));
    expect(document.querySelector('pre[data-title="my-theme.css"]')).toBeNull();
    expect(screen.getByText("the preset's own")).toBeTruthy();
  });

  it("sends the look picked so far when its frame says it listens, and only then", () => {
    const { frame, postMessage } = draw();
    fireEvent.click(screen.getByRole("radio", { name: /^Fintech/ }));
    postMessage.mockClear();
    const ready = (init: MessageEventInit) => act(() => void window.dispatchEvent(new MessageEvent("message", { data: { type: LIVE_READY_MESSAGE }, ...init })));
    ready({ origin: "https://elsewhere.test", source: frame.contentWindow });
    ready({ origin: window.location.origin, source: window });
    expect(postMessage).not.toHaveBeenCalled();
    ready({ origin: window.location.origin, source: frame.contentWindow });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ preset: "fintech" }), window.location.origin);
  });

  it("highlights both code blocks as the docs' own are, each a Tab stop", () => {
    draw();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.75" } });
    expect([...drawnBlocks.keys()].sort()).toEqual(["Themed.tsx", "my-theme.css"]);
    for (const block of drawnBlocks.values()) {
      expect(block.options).toBe(CODE_HIGHLIGHT);
      expect(block.codeblock?.viewportProps).toBe(SCROLL_REGION);
    }
  });

  it("is driven by native radios: one group per choice, each named once", () => {
    draw();
    expect(screen.getAllByRole("group").map((group) => group.getAttribute("aria-label") ?? group.querySelector("legend")?.textContent)).toEqual(["Preset", "Colour mode"]);
    expect(screen.getAllByRole("radio").every((radio) => radio.tagName === "INPUT")).toBe(true);
  });
});
