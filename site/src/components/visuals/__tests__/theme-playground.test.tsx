/**
 * `<ThemePlayground>`: the chat panel demo framed in the default look, the
 * six presets, light or dark and a radius as controls, each change posted to
 * the frame from the page's own origin (and posted again when the frame
 * loads), and the code beside it following the pick.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { THEME_PRESETS } from "@stigmer/design-tokens";
import { LIVE_CAPTION, LIVE_THEME_MESSAGE } from "@/lib/live";
import { ThemePlayground } from "../ThemePlayground";

vi.mock("fumadocs-ui/components/dynamic-codeblock", () => ({
  DynamicCodeBlock: ({ code, codeblock }: { code: string; codeblock?: { title?: string } }) => (
    <pre data-title={codeblock?.title}>{code}</pre>
  ),
}));

afterEach(cleanup);

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
    expect(screen.getAllByRole("radio", { checked: true }).map((radio) => radio.textContent)).toEqual([expect.stringContaining("Default"), "dark"]);
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

  it("gives a frame that loads after a change the look picked so far", () => {
    const { frame, postMessage } = draw();
    fireEvent.click(screen.getByRole("radio", { name: /^Fintech/ }));
    postMessage.mockClear();
    fireEvent.load(frame);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ preset: "fintech" }), window.location.origin);
  });
});
