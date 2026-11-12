/**
 * Proves the ended turn's notice (../RunErrorNotice.tsx): it reads the
 * ending's headline and comfort, never the raw error; its one act and at
 * most one link are the ones it is handed; a red ending offers Copy details,
 * which copies the raw error, the run id and the kind, while an amber or
 * grey one does not and reads as a status rather than an alert; an act in
 * flight waits; an external link opens in a new tab; and without an ending
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

  it("reads a pause as a status, with no Copy details", () => {
    render(<RunErrorNotice error="Agent reached the cost limit" ending={{ ...KEY, tone: "paused", headline: "This turn reached its spending cap." }} />);

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("This turn reached its spending cap.");
    expect(screen.queryByRole("button", { name: "Copy details" })).toBeNull();
  });

  it("holds the act while it is in flight, and opens an external link in a new tab", () => {
    render(<RunErrorNotice error="x" ending={KEY} actLabel="Run again" onAct={vi.fn()} acting link={{ label: "Anthropic status", href: "https://status.anthropic.com", external: true }} />);

    expect((screen.getByRole("button", { name: "Run again" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("link", { name: "Anthropic status" }).getAttribute("target")).toBe("_blank");
  });

  it("reads the generic sentence without an ending, and re-sends the turn's message", () => {
    const onRetry = vi.fn();
    render(<RunErrorNotice error="boom" retryMessage="do it" onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toContain("This turn didn't finish.");
    fireEvent.click(screen.getByRole("button", { name: "Run again" }));
    expect(onRetry).toHaveBeenCalledWith("do it");
  });

  it("offers no act when it is handed none and has nothing to re-send", () => {
    render(<RunErrorNotice error="boom" ending={{ ...KEY, act: "none" }} />);
    expect(screen.queryByRole("button", { name: /again/ })).toBeNull();
  });
});
