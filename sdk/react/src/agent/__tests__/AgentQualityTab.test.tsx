/**
 * Pins the agent's Quality tab: an agent with no evaluator shows grading
 * off and, when editable, switching it on creates the evaluator with one
 * run in ten and ten dollars a month; a stored evaluator shows its
 * settings and this month's spend and last not-graded reason, and a save
 * updates it by id; read-only, the controls are disabled and no save is
 * offered.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { AgentQualityTab } from "../AgentQualityTab";

vi.mock("../../models/ModelSelector.js", () => ({
  ModelSelector: ({ onValueChange }: { onValueChange: (modelId: string) => void }) => (
    <button type="button" onClick={() => onValueChange("claude-haiku-4-5")}>
      pick a model
    </button>
  ),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const agent = create(AgentSchema, { metadata: { id: "agt_1", org: "org_acme", name: "triage" } });

function stored() {
  return create(EvaluatorSchema, {
    metadata: { id: "evl_1", name: "evl_1", org: "org_acme" },
    spec: { agentId: "agt_1", enabled: true, sampleRate: 0.5, monthlyLimitUsd: 20 },
    status: {
      period: "2026-10",
      spentUsd: 1.5,
      reservedUsd: 0.25,
      graded: 12,
      notGraded: 1,
      lastNotGradedReason: "out of credit",
    },
  });
}

function client(evaluator: ReturnType<typeof stored> | null) {
  return {
    evaluator: {
      getByAgent: evaluator === null
        ? vi.fn().mockRejectedValue(
            // What the SDK client throws for NOT_FOUND (its error mapping).
            new StigmerError("not-found", "agent agt_1 has no evaluator: AI grading is off", Code.NotFound),
          )
        : vi.fn().mockResolvedValue(evaluator),
      create: vi.fn().mockImplementation(async () => stored()),
      update: vi.fn().mockImplementation(async () => stored()),
    },
  };
}

function wrap(mock: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={mock as never}>{children}</StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("AgentQualityTab", () => {
  it("switches grading on for an agent that has none, with the defaults", async () => {
    const mock = client(null);
    render(<AgentQualityTab agent={agent} editable />, { wrapper: wrap(mock) });
    const toggle = await screen.findByRole("switch");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.evaluator.create).toHaveBeenCalledTimes(1));
    expect(mock.evaluator.create.mock.calls[0]?.[0]).toMatchObject({
      org: "org_acme",
      agentId: "agt_1",
      enabled: true,
      sampleRate: 0.1,
      monthlyLimitUsd: 10,
    });
    expect(mock.evaluator.update).not.toHaveBeenCalled();
  });

  it("shows the stored settings and this month, and updates by id", async () => {
    const mock = client(stored());
    render(<AgentQualityTab agent={agent} editable />, { wrapper: wrap(mock) });
    const oneIn = (await screen.findByLabelText("Grade one in N runs")) as HTMLInputElement;
    expect(oneIn.value).toBe("2");
    expect(screen.getByText("$1.50")).toBeDefined();
    expect(screen.getByText("$0.25")).toBeDefined();
    expect(screen.getByText("Last not graded: out of credit")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Monthly limit (USD, estimated model spend)"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.evaluator.update).toHaveBeenCalledTimes(1));
    expect(mock.evaluator.update.mock.calls[0]?.[0]).toMatchObject({ id: "evl_1", monthlyLimitUsd: 30, sampleRate: 0.5 });
  });

  it("warns that a limit below one grade's maximum cost grades no run", async () => {
    render(<AgentQualityTab agent={agent} editable />, { wrapper: wrap(client(stored())) });
    const limit = await screen.findByLabelText("Monthly limit (USD, estimated model spend)");
    expect(screen.queryByText(/a limit\s+below \$0\.25 grades no run/)).toBeNull();
    fireEvent.change(limit, { target: { value: "0.1" } });
    expect(screen.getByText(/a limit\s+below \$0\.25 grades no run/)).toBeDefined();
  });

  it("changes the sample and the model, and shows a refused save", async () => {
    const mock = client(stored());
    mock.evaluator.update.mockRejectedValueOnce(new Error("unauthorized to update evaluator"));
    render(<AgentQualityTab agent={agent} editable />, { wrapper: wrap(mock) });
    fireEvent.change(await screen.findByLabelText("Grade one in N runs"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "pick a model" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toContain("unauthorized to update evaluator");
    expect(mock.evaluator.update.mock.calls[0]?.[0]).toMatchObject({ sampleRate: 0.25, modelName: "claude-haiku-4-5" });
  });

  it("shows a read that failed for another reason than grading being off", async () => {
    const mock = client(stored());
    mock.evaluator.getByAgent = vi.fn().mockRejectedValue(new Error("server unavailable"));
    render(<AgentQualityTab agent={agent} />, { wrapper: wrap(mock) });
    expect(await screen.findByText(/server unavailable/)).toBeDefined();
  });

  it("offers no save and disables the controls when read-only", async () => {
    render(<AgentQualityTab agent={agent} />, { wrapper: wrap(client(stored())) });
    const toggle = await screen.findByRole("switch");
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
