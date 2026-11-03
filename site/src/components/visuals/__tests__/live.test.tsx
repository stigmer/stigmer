/**
 * `<Live>`: the docs' live demo by its name, framed at the gallery's docs
 * address, lazily, at the list's height, titled for
 * assistive technology and captioned as a replay; refusing a name the list
 * does not hold or blank alt text, so the build fails on the page that
 * asked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LIVE_CAPTION, liveDemo } from "@/lib/live";
import { Live } from "../Live";

afterEach(cleanup);

const ALT = "The popup, open on a finished turn";

describe("Live", () => {
  it("frames the demo in the docs mode, lazily, at its height, with its title and the replay caption", () => {
    const { container } = render(<Live name="chat-popup" alt={ALT} />);
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("src")).toBe("/gallery/?scene=agent-chat-popup&mode=dark&embed=1");
    expect(frame.getAttribute("loading")).toBe("lazy");
    expect(frame.getAttribute("title")).toBe(liveDemo("chat-popup").title);
    expect(frame.getAttribute("aria-label")).toBe(ALT);
    expect(frame.style.height).toBe(`${liveDemo("chat-popup").height}px`);
    expect(screen.getByText(LIVE_CAPTION)).toBeTruthy();
  });

  it("refuses a demo the visual suite does not list, and blank alt text", () => {
    expect(() => render(<Live name="chat-popover" alt={ALT} />)).toThrow(/no live demo named "chat-popover"/);
    expect(() => render(<Live name="chat-popup" alt=" " />)).toThrow(/alt text is required/);
  });
});
