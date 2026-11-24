/**
 * `<SetupPrompt />`, the docs front page's one thing to do: it shows the
 * brand's setup prompt whole, copies exactly that prompt from a real button
 * that says so for a moment, and says where the prompt goes.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODING_AGENT_PROMPT } from "../../../../../brand/coding-agent-prompt";
import { THEN } from "@/components/visuals/setup-prompt";
import { SetupPrompt } from "../setup-prompt";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SetupPrompt", () => {
  it("shows the brand's prompt whole, wrapped to the column, and says where to paste it", () => {
    const { container } = render(<SetupPrompt />);
    const block = container.querySelector("pre")!;
    expect(block.textContent).toBe(CODING_AGENT_PROMPT);
    expect(block.className).toContain("whitespace-pre-wrap");
    expect(container.querySelector("figcaption")?.textContent).toContain(THEN);
    expect(THEN).toContain("in your app's folder");
  });

  it("copies the prompt from a real button, 44px tall, that says Copied for a moment", async () => {
    vi.useFakeTimers();
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });
    render(<SetupPrompt />);
    const button = screen.getByRole("button", { name: "Copy the prompt" });
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.className).toContain("h-11");

    await act(async () => {
      fireEvent.click(button);
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(CODING_AGENT_PROMPT);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("button", { name: "Copy the prompt" })).toBeTruthy();
  });

  it("is one figure out of the docs body's prose styles, with nothing that plays", () => {
    const { container } = render(<SetupPrompt className="mt-2" />);
    const figure = container.firstElementChild as HTMLElement;
    expect(figure.tagName).toBe("FIGURE");
    expect(figure.className).toContain("not-prose");
    expect(figure.className).toContain("mt-2");
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});
