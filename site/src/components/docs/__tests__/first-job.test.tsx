/**
 * `<FirstJob />`: the Terminal tab first, playing the kit's `first-job`
 * recording once the box is in view; Your app chosen by pointer or arrow key
 * plays from its start while the terminal waits; Play again replays the tab
 * showing; Copy, on the code tab only, copies the program whole; under
 * reduced motion both tabs show the job done and nothing offers to play; the
 * footer carries the install line, both step-by-step pages and, on the
 * Terminal tab, the line every recording carries.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDED_LINE, recording } from "@/lib/recordings";
import { plainText } from "@/lib/sgr";
import { INSTALL, RECORDING, STEP_BY_STEP, TERMINAL_ALT } from "@/components/visuals/first-job";
import { MOMENTS, PRINTS, PROGRAM, PROGRAM_FILE, WORKED_SECONDS } from "@/components/visuals/first-job-app";
import { FirstJob } from "../first-job";

const HELD = recording(RECORDING);

/** Each observer made, with what it watches: next/link's links watch themselves too. */
let observers: { callback: (entries: { isIntersecting: boolean; target: Element }[]) => void; watched: Element[] }[] = [];
let reduced = false;

/** The block scrolls into view: the observers watching it hear so. */
function intoView() {
  const block = document.querySelector("[data-first-job]")!;
  for (const observer of observers.filter((entry) => entry.watched.includes(block))) {
    act(() => observer.callback([{ isIntersecting: true, target: block }]));
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      private readonly entry: (typeof observers)[number];
      constructor(callback: (typeof observers)[number]["callback"]) {
        this.entry = { callback, watched: [] };
        observers.push(this.entry);
      }
      observe(element: Element) {
        this.entry.watched.push(element);
      }
      unobserve() {}
      disconnect() {
        this.entry.watched = [];
      }
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }));
  window.matchMedia = globalThis.matchMedia;
  HTMLElement.prototype.scrollTo = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The terminal's text now. */
function terminal(): string {
  return screen.getByRole("img", { name: TERMINAL_ALT }).textContent ?? "";
}

/** The frame at `index`, its last rows, joined as the `<pre>`'s text joins them. */
function frameText(index: number): string {
  return plainText(HELD.frames[index]!.text).split("\n").slice(-HELD.rows).join("");
}

/** The app tab's clock now, or null before the job starts. */
function clock(container: HTMLElement): string | null {
  return container.querySelector("[data-clock]")?.textContent ?? null;
}

function choose(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

describe("FirstJob", () => {
  it("opens on the Terminal tab and plays the recording once the box is in view", () => {
    render(<FirstJob />);
    expect(screen.getByRole("tab", { name: "Terminal" }).getAttribute("aria-selected")).toBe("true");
    expect(terminal()).toBe(frameText(0));
    act(() => vi.advanceTimersByTime(60_000));
    expect(terminal()).toBe(frameText(0));
    intoView();
    act(() => vi.advanceTimersByTime(HELD.frames[1]!.at));
    expect(terminal()).toBe(frameText(1));
    expect(screen.queryByRole("button", { name: `Copy ${PROGRAM_FILE}` })).toBeNull();
  });

  it("plays Your app from its start when chosen, and the terminal again from its start when chosen back", () => {
    const { container } = render(<FirstJob />);
    intoView();
    act(() => vi.advanceTimersByTime(HELD.frames[2]!.at));
    choose("Your app");
    expect(screen.getByRole("tab", { name: "Your app" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText(PROGRAM_FILE)).toBeTruthy();
    expect(clock(container)).toBeNull();
    for (let i = 0; i < MOMENTS.length; i += 1) act(() => vi.advanceTimersByTime(1_000));
    expect(clock(container)).toBe(`${WORKED_SECONDS}s`);
    expect(container.querySelector("[data-console]")!.textContent).toContain(PRINTS);

    choose("Terminal");
    expect(terminal()).toBe(frameText(0));
  });

  it("moves between the tabs with the arrow keys", () => {
    render(<FirstJob />);
    const first = screen.getByRole("tab", { name: "Terminal" });
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowRight" });
    // Radix moves the focus on a timer.
    act(() => vi.advanceTimersByTime(0));
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Your app" }));
    expect(screen.getByRole("tab", { name: "Your app" }).getAttribute("aria-selected")).toBe("true");
  });

  it("replays the tab showing from its start", () => {
    render(<FirstJob />);
    intoView();
    for (let i = 0; i < HELD.frames.length; i += 1) act(() => vi.advanceTimersByTime(10_000));
    expect(terminal()).toBe(frameText(HELD.frames.length - 1));
    fireEvent.click(screen.getByRole("button", { name: "Play again" }));
    expect(terminal()).toBe(frameText(0));
    act(() => vi.advanceTimersByTime(HELD.frames[1]!.at));
    expect(terminal()).toBe(frameText(1));
  });

  it("copies the program whole from the code tab", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { clipboard });
    render(<FirstJob />);
    choose("Your app");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: `Copy ${PROGRAM_FILE}` }));
    });
    expect(clipboard.writeText).toHaveBeenCalledWith(`${PROGRAM.join("\n")}\n`);
    expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy();
  });

  it("shows both tabs with the job done, and offers nothing to play, under reduced motion", () => {
    reduced = true;
    const { container } = render(<FirstJob />);
    expect(terminal()).toBe(frameText(HELD.frames.length - 1));
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
    choose("Your app");
    expect(clock(container)).toBe(`${WORKED_SECONDS}s`);
    expect(screen.queryByRole("button", { name: "Play again" })).toBeNull();
  });

  it("keeps the install line and both step-by-step pages in the footer, and says the terminal is recorded", () => {
    const { container } = render(<FirstJob />);
    const footer = container.querySelector("[data-first-job] > figcaption")!;
    expect(footer.textContent).toContain(INSTALL);
    expect([...footer.querySelectorAll("a")].map((link) => [link.textContent, link.getAttribute("href")])).toEqual(
      STEP_BY_STEP.map((page) => [page.title, page.href]),
    );
    expect(footer.textContent).toContain(RECORDED_LINE);
    choose("Your app");
    expect(container.querySelector("[data-first-job] > figcaption")!.textContent).not.toContain(RECORDED_LINE);
  });

  it("lets a keyboard reach the terminal box, which scrolls sideways on a narrow screen", () => {
    render(<FirstJob />);
    expect(screen.getByRole("region", { name: "Terminal recording" }).getAttribute("tabindex")).toBe("0");
  });
});
