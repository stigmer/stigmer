/**
 * Proves the ended turn's notice (../RunErrorNotice.tsx): it reads the
 * ending's headline and comfort, never the raw error; its one act and at
 * most one link are the ones it is handed, its act at the kit's notice size;
 * a failed or interrupted ending offers Copy details with its icon, which
 * copies the raw error, the run id and the kind; an amber or grey one reads as a
 * status rather than an alert, a limit with the info mark and an
 * interruption with the clock; an act in flight waits; an external link
 * opens in a new tab and says so with an arrow; and without an ending
 * or an act, it reads the generic sentence and falls back to re-sending the
 * turn's message.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { TurnEnding } from "@stigmer/client";
import { RunErrorNotice } from "../RunErrorNotice";

const KEY: TurnEnding = {
  tone: "failed",
  pill: "Didn't finish",
  headline: "Anthropic refused this organization's model key.",
  comfort: "The key on Models & providers isn't valid any more.",
  stepNote: "Stopped here",
  act: "run_again",
  link: "models_hub",
  kind: "provider_key_rejected",
};

const writeText = vi.fn();
beforeEach(() => {
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RunErrorNotice", () => {
  it("reads the ending's words, never the raw error, with its act and its link", () => {
    const onAct = vi.fn();
    render(
      <RunErrorNotice
        error="[LLM_AUTHENTICATION_ERROR] 401"
        ending={KEY}
        runId="run_1"
        actLabel="Run again"
        onAct={onAct}
        link={{ label: "Open Models & providers", href: "/models" }}
      />,
    );

    const notice = screen.getByRole("alert");
    expect(notice.textContent).toContain("Anthropic refused this organization's model key.");
    expect(notice.textContent).not.toContain("LLM_AUTHENTICATION_ERROR");
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onAct).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Open Models & providers" }).getAttribute("href")).toBe("/models");
  });

  it("copies the raw error, the run id and the kind", async () => {
    render(<RunErrorNotice error="[LLM_AUTHENTICATION_ERROR] 401" ending={KEY} runId="run_1" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("[LLM_AUTHENTICATION_ERROR] 401\nRun: run_1\nKind: provider_key_rejected");
  });

  it("reads a pause as a status: a limit with no Copy details, an interruption with them", () => {
    const { rerender } = render(<RunErrorNotice error="Agent reached the cost limit" ending={{ ...KEY, tone: "paused", headline: "This turn reached its spending cap.", kind: "cost_cap" }} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("This turn reached its spending cap.");
    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();

    rerender(<RunErrorNotice error="runner lost" ending={{ ...KEY, tone: "paused", headline: "The turn was interrupted.", kind: "runner_lost" }} />);
    expect(screen.getByRole("button", { name: "Copy details" }).querySelector("svg")).not.toBeNull();
  });

  it("marks a limit with the info mark and an interruption with the clock", () => {
    const { container, rerender } = render(<RunErrorNotice error="" ending={{ ...KEY, tone: "paused", kind: "cost_cap" }} />);
    // The info mark's dot; the clock has hands.
    expect(container.querySelector('path[d="M12 16v-4M12 8h.01"]')).not.toBeNull();

    rerender(<RunErrorNotice error="" ending={{ ...KEY, tone: "paused", kind: "runner_lost" }} />);
    expect(container.querySelector('path[d="M12 6v6l4 2"]')).not.toBeNull();
  });

  it("holds the act while it is in flight, and opens an external link in a new tab", () => {
    render(<RunErrorNotice error="x" ending={KEY} actLabel="Run again" onAct={vi.fn()} acting link={{ label: "Anthropic's status page", href: "https://status.anthropic.com", external: true }} />);

    const act = screen.getByRole("button", { name: "Run again" }) as HTMLButtonElement;
    expect(act.disabled).toBe(true);
    expect(act.className).toContain("stg:h-7");
    const link = screen.getByRole("link", { name: "Anthropic's status page" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.textContent).toBe("Anthropic's status page ↗");
  });

  it("reads the generic sentence without an ending, and re-sends the turn's message", () => {
    const onRetry = vi.fn();
    render(<RunErrorNotice error="boom" retryMessage="do it" onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("This turn didn't finish.");
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRetry).toHaveBeenCalledWith("do it");
  });

  it("draws a link with no address as a button that acts", () => {
    const onClick = vi.fn();
    render(<RunErrorNotice error="x" ending={KEY} link={{ label: "Choose another model", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose another model" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("offers no act when it is handed none and has nothing to re-send", () => {
    render(<RunErrorNotice error="boom" ending={{ ...KEY, act: "none" }} />);
    expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
  });
});
