// useModelCatalogView over a mocked useModelPricingBaselines: ACTIVE
// revisions become rows with their history folded in, the list sorts by
// display name and narrows by search, and the list/create/detail flow
// moves only where it should. The RPC wiring is pinned by the console's
// suite.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  type ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { useModelCatalogView } from "../useModelCatalogView";

const baselinesReturn = vi.fn();
vi.mock("../useModelPricingBaselines", () => ({
  useModelPricingBaselines: (options: unknown) => {
    lastBaselinesOptions = options;
    return baselinesReturn();
  },
}));

let lastBaselinesOptions: unknown = null;

function baseline(overrides: Record<string, unknown> = {}): ModelPricingBaseline {
  return create(ModelPricingBaselineSchema, {
    baselineId: "bl-sonnet",
    modelId: "claude-sonnet-4-6",
    provider: "anthropic",
    harness: "native",
    displayName: "Claude Sonnet",
    status: ModelPricingBaselineStatus.pricing_baseline_active,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: 3_000_000n,
      outputPriceMicrosPerMillion: 15_000_000n,
    }),
    ...overrides,
  });
}

function setData({
  baselines = [] as readonly ModelPricingBaseline[],
} = {}) {
  baselinesReturn.mockReturnValue({
    baselines,
    isLoading: false,
    isRefetching: false,
    error: null,
    refetch: vi.fn(),
  });
}

/** Renders the hook and exposes the parts under test via data attributes. */
function Probe() {
  const view = useModelCatalogView();
  return (
    <div>
      <div
        data-testid="models"
        data-keys={view.models.map((m) => m.key).join(";")}
        data-history={view.models.map((m) => m.history.length).join(";")}
      />
      <div
        data-testid="flow"
        data-phase={view.flow.phase}
        data-mode={view.flow.phase === "detail" ? view.flow.mode : ""}
        data-selected={view.selected?.key ?? "none"}
      />
      <input
        aria-label="model query"
        value={view.modelQuery}
        onChange={(e) => view.setModelQuery(e.target.value)}
      />
      <button onClick={() => view.openDetail("claude-sonnet-4-6|anthropic|native")}>detail</button>
      <button onClick={() => view.openEdit()}>edit</button>
      <button onClick={() => view.openRetire()}>retire</button>
      <button onClick={() => view.backToDetail()}>back-detail</button>
      <button onClick={() => view.backToList()}>back-list</button>
      <button onClick={() => view.openCreate()}>create</button>
    </div>
  );
}

beforeEach(() => {
  setData();
});

afterEach(() => {
  cleanup();
  baselinesReturn.mockReset();
});

describe("useModelCatalogView — rows", () => {
  it("separates ACTIVE rows from their revision history", () => {
    setData({
      baselines: [
        baseline(),
        baseline({
          baselineId: "bl-old",
          status: ModelPricingBaselineStatus.pricing_baseline_superseded,
        }),
      ],
    });
    render(<Probe />);

    const models = screen.getByTestId("models");
    expect(models.getAttribute("data-keys")).toBe("claude-sonnet-4-6|anthropic|native");
    expect(models.getAttribute("data-history")).toBe("1");
  });

  it("always fetches with history so the detail view needs no second round-trip", () => {
    render(<Probe />);
    expect(lastBaselinesOptions).toEqual({ includeHistory: true });
  });

  it("sorts models by display name", () => {
    setData({
      baselines: [
        baseline({ baselineId: "bl-z", modelId: "z-model", displayName: "Zed" }),
        baseline({ baselineId: "bl-a", modelId: "a-model", displayName: "Alpha" }),
      ],
    });
    render(<Probe />);

    expect(screen.getByTestId("models").getAttribute("data-keys")).toBe(
      "a-model|anthropic|native;z-model|anthropic|native",
    );
  });
});

describe("useModelCatalogView — search", () => {
  it("filters models by id, display name, or provider (case-insensitive)", () => {
    setData({
      baselines: [
        baseline(),
        baseline({ baselineId: "bl-gpt", modelId: "gpt-5.6", provider: "openai", displayName: "GPT" }),
      ],
    });
    render(<Probe />);

    fireEvent.change(screen.getByLabelText("model query"), { target: { value: "OPENAI" } });
    expect(screen.getByTestId("models").getAttribute("data-keys")).toBe(
      "gpt-5.6|openai|native",
    );
  });
});

describe("useModelCatalogView — flow", () => {
  it("walks list → detail (view → edit → view → retire) → list", () => {
    setData({ baselines: [baseline()] });
    render(<Probe />);
    const flow = screen.getByTestId("flow");

    expect(flow.getAttribute("data-phase")).toBe("list");

    fireEvent.click(screen.getByText("detail"));
    expect(flow.getAttribute("data-phase")).toBe("detail");
    expect(flow.getAttribute("data-mode")).toBe("view");
    expect(flow.getAttribute("data-selected")).toBe("claude-sonnet-4-6|anthropic|native");

    fireEvent.click(screen.getByText("edit"));
    expect(flow.getAttribute("data-mode")).toBe("edit");

    fireEvent.click(screen.getByText("back-detail"));
    expect(flow.getAttribute("data-mode")).toBe("view");

    fireEvent.click(screen.getByText("retire"));
    expect(flow.getAttribute("data-mode")).toBe("retire");

    fireEvent.click(screen.getByText("back-list"));
    expect(flow.getAttribute("data-phase")).toBe("list");
  });

  it("ignores edit/retire transitions outside the detail phase", () => {
    setData({ baselines: [baseline()] });
    render(<Probe />);
    const flow = screen.getByTestId("flow");

    fireEvent.click(screen.getByText("edit"));
    expect(flow.getAttribute("data-phase")).toBe("list");

    fireEvent.click(screen.getByText("create"));
    fireEvent.click(screen.getByText("retire"));
    expect(flow.getAttribute("data-phase")).toBe("create");
  });

  it("resolves selected to null when the focused model disappears (e.g. retired)", () => {
    setData({ baselines: [baseline()] });
    const { rerender } = render(<Probe />);

    fireEvent.click(screen.getByText("detail"));
    expect(screen.getByTestId("flow").getAttribute("data-selected")).toBe(
      "claude-sonnet-4-6|anthropic|native",
    );

    setData({ baselines: [] });
    rerender(<Probe />);
    expect(screen.getByTestId("flow").getAttribute("data-selected")).toBe("none");
  });
});
