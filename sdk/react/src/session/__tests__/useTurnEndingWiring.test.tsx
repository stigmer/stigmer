/**
 * Proves the session view's ending wiring (../useTurnEndingWiring.ts): Run
 * again and Resume recover a FAILED run for a reader the server lets edit
 * it, and re-send its message ("Send it again") for one it doesn't; recover
 * is asked of the server only for a failed turn a reader may act on;
 * Continue sends "Continue"; the platform's stop re-sends; Choose another
 * model opens the composer's picker; a refused request offers nothing; the
 * fix's link goes to Models & providers, the agent's page, or the provider's
 * billing or status page, and a provider the kit doesn't know gets none; and
 * the model id resolves to its provider's and its own display names.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Turn, TurnEnding } from "@stigmer/client";

const checks = vi.fn();
const recover = vi.fn();
vi.mock("../../grant/useCheckPermission", () => ({
  useCheckPermission: (resource: unknown, relation: string) => checks(resource, relation),
}));
vi.mock("@stigmer/react-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/react-core")>()),
  useRunActions: () => ({ recover, isSubmitting: false, error: null, clearError: () => {} }),
}));
vi.mock("../../models/useModelRegistry", () => ({
  useModelRegistry: () => ({
    getModel: (id: string) =>
      id === "claude-sonnet-4-6" ? { modelId: id, provider: "anthropic", displayName: "Claude Sonnet 4.6" } : id === "grok" ? { modelId: id, provider: "xai", displayName: "Grok" } : undefined,
  }),
}));

import { useTurnEndingWiring, type TurnEndingWiringInput } from "../useTurnEndingWiring";

function turn(phase: "failed" | "terminated" | "completed", stopCause: string, kind?: string, model = ""): Turn {
  return {
    runId: "run_1",
    ended: true,
    status: { phase, stopCause, error: "boom", processedAt: "", ...(kind === undefined ? {} : { stopDetail: { kind, model, app: "" } }) },
  } as unknown as Turn;
}

function ending(act: TurnEnding["act"], link: TurnEnding["link"] = "none"): TurnEnding {
  return { tone: "failed", pill: "", headline: "", comfort: "", stepNote: "", act, link, kind: "" };
}

const send = vi.fn();
const click = vi.fn();
function wire(over: Partial<TurnEndingWiringInput> = {}) {
  const picker = document.createElement("button");
  picker.setAttribute("data-model-picker", "");
  picker.addEventListener("click", click);
  const column = document.createElement("div");
  column.appendChild(picker);
  const input: TurnEndingWiringInput = {
    lastTurn: turn("failed", "model_error", "provider_key_rejected", "claude-sonnet-4-6"),
    orgId: "org_1",
    canSend: true,
    decides: true,
    send,
    retryMessage: "fix the rounding",
    modelsHubHref: "/models",
    agentHref: "/library/agents/acme/fixer",
    columnRef: { current: column },
    ...over,
  };
  return renderHook(() => useTurnEndingWiring(input)).result.current.wiring;
}

beforeEach(() => {
  vi.clearAllMocks();
  checks.mockReturnValue({ allowed: true, isLoading: false });
});

describe("useTurnEndingWiring", () => {
  it("recovers a failed turn for a reader the server lets edit the run", () => {
    const { actOf, viewer } = wire();
    const run = actOf?.(ending("run_again"), turn("failed", "x"));
    expect(run?.label).toBe("Run again");
    run?.run();
    expect(recover).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(actOf?.(ending("resume"), turn("failed", "x"))?.label).toBe("Resume");
    expect(viewer.canManageProviders).toBe(true);
    expect(checks).toHaveBeenCalledWith({ kind: "run", id: "run_1" }, "can_edit");
  });

  it("re-sends the message for a reader the server won't let recover", () => {
    checks.mockReturnValue({ allowed: false, isLoading: false });
    const { actOf } = wire();
    const run = actOf?.(ending("run_again"), turn("failed", "x"));
    expect(run?.label).toBe("Send it again");
    run?.run();
    expect(send).toHaveBeenCalledWith("fix the rounding");
    expect(recover).not.toHaveBeenCalled();
  });

  it("asks nothing of the server for a turn that wasn't a failure, or a reader who can't send", () => {
    wire({ lastTurn: turn("terminated", "budget_reached", "cost_cap") });
    expect(checks).toHaveBeenCalledWith(null, "can_edit");
    vi.clearAllMocks();
    wire({ canSend: false });
    expect(checks).toHaveBeenCalledWith(null, "can_edit");
  });

  it("continues with a message, re-sends after the platform's stop, opens the model picker, and offers nothing for a refused request", () => {
    const { actOf } = wire();
    actOf?.(ending("continue"), turn("terminated", "budget_reached"))?.run();
    expect(send).toHaveBeenLastCalledWith("Continue");
    actOf?.(ending("rerun"), turn("completed", "platform_stop"))?.run();
    expect(send).toHaveBeenLastCalledWith("fix the rounding");
    const choose = actOf?.(ending("choose_model"), turn("failed", "x"));
    expect(choose?.label).toBe("Choose another model");
    choose?.run();
    expect(click).toHaveBeenCalledOnce();
    expect(actOf?.(ending("none"), turn("failed", "x"))).toBeUndefined();
  });

  it("links each fix where it lives, and a provider the kit doesn't know nowhere", () => {
    const { linkOf } = wire();
    const known = turn("failed", "model_error", "provider_out_of_credit", "claude-sonnet-4-6");
    expect(linkOf?.(ending("run_again", "models_hub"), known)).toEqual({ label: "Open Models & providers", href: "/models" });
    expect(linkOf?.(ending("run_again", "agent"), known)).toEqual({ label: "Open the agent", href: "/library/agents/acme/fixer" });
    expect(linkOf?.(ending("run_again", "provider_billing"), known)).toEqual({
      label: "Open Anthropic billing",
      href: "https://console.anthropic.com/settings/billing",
      external: true,
    });
    expect(linkOf?.(ending("run_again", "provider_status"), known)?.href).toBe("https://status.anthropic.com");
    expect(linkOf?.(ending("run_again", "provider_status"), turn("failed", "model_error", "provider_overloaded", "grok"))).toBeUndefined();
    expect(wire({ agentHref: undefined }).linkOf?.(ending("run_again", "agent"), known)).toBeUndefined();
  });

  it("names the model and its provider from the registry", () => {
    const { names } = wire();
    expect(names?.("claude-sonnet-4-6")).toEqual({ provider: "Anthropic", model: "Claude Sonnet 4.6" });
    expect(names?.("unknown-model")).toEqual({});
  });
});
