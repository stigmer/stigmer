/**
 * Pins BaselineEditor's confirm step for a rate edit: after the operator
 * changes a rate and asks to review, the step lists each moving rate with
 * its value now and its new value, and sends nothing until the prices are
 * saved. And the long-prompt step (stigmer#3138): the form shows a model's
 * step, base and variant, so an edit that leaves it alone keeps it; filling
 * the "Long prompts" group adds one, each change its own line in the
 * confirm ("Input above 100,000"); emptying it removes it; a group partly
 * filled is one form error and sends nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ModelPricingBaselineSchema,
  LongContextPricingSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
  PricingVariantSchema,
  type ModelPricingBaseline,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { BaselineEditor } from "../BaselineEditor";

const SONNET = create(ModelPricingBaselineSchema, {
  baselineId: "bl-1",
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  harness: "stigmer",
  displayName: "Claude Sonnet",
  status: ModelPricingBaselineStatus.pricing_baseline_active,
  pricing: create(PricingBlockSchema, {
    inputPriceMicrosPerMillion: 3_000_000n,
    outputPriceMicrosPerMillion: 15_000_000n,
  }),
});

const step = (inputMicros: bigint) =>
  create(LongContextPricingSchema, {
    thresholdTokens: 100_000,
    inputPriceMicrosPerMillion: inputMicros,
    outputPriceMicrosPerMillion: inputMicros * 5n,
    cacheWritePriceMicrosPerMillion: inputMicros,
    cacheReadPriceMicrosPerMillion: inputMicros / 10n,
  });

function renderEditor(initial: ModelPricingBaseline) {
  const onSubmit = vi.fn(async (_baseline: ModelPricingBaseline, _note: string) => undefined);
  render(
    <BaselineEditor initial={initial} isSubmitting={false} submitError={null} onSubmit={onSubmit} onCancel={vi.fn()} />,
  );
  return onSubmit;
}

/** The confirm's lines, each as "rate: now → new". */
function changeLines(): string[] {
  const table = screen.getByRole("table", { name: "Rate changes" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const [rate, now, next] = within(row).getAllByRole("cell").map((cell) => cell.textContent);
      return `${rate}: ${now} → ${next}`;
    });
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
  });
}

afterEach(cleanup);

describe("BaselineEditor variants", () => {
  it("adds an empty variant, with its key and four rates, on Add variant", () => {
    renderEditor(SONNET);
    const before = screen.queryAllByLabelText("Variant key").length;
    fireEvent.click(screen.getByRole("button", { name: "Add variant" }));
    const keys = screen.getAllByLabelText("Variant key");
    expect(keys).toHaveLength(before + 1);
    expect((keys[keys.length - 1] as HTMLInputElement).value).toBe("");
  });
});

describe("BaselineEditor confirm step", () => {
  it("asks in a dialog over the form, which Back closes with the form as it was", () => {
    renderEditor(SONNET);
    fireEvent.change(screen.getByLabelText("Input ($/M)"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog", { name: /Save these prices for/ });
    expect(within(dialog).getByRole("table", { name: "Rate changes" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("Input ($/M)") as HTMLInputElement).value).toBe("4");
  });

  it("lists the moving rate, now and new, and sends nothing until saved", () => {
    const onSubmit = renderEditor(SONNET);

    fireEvent.change(screen.getByLabelText("Input ($/M)"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(changeLines()).toEqual(["Input: $3.00/M → $4.00/M"]);
    expect(screen.getByText(/Charges already made keep their rates/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("BaselineEditor and the long-prompt step (#3138)", () => {
  const STEPPED = create(ModelPricingBaselineSchema, {
    ...SONNET,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: 3_000_000n,
      outputPriceMicrosPerMillion: 15_000_000n,
      longContext: step(6_000_000n),
    }),
    pricingVariants: {
      fast: create(PricingVariantSchema, {
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 6_000_000n,
          outputPriceMicrosPerMillion: 30_000_000n,
          longContext: step(12_000_000n),
        }),
      }),
    },
  });

  it("round-trips the step, base and variant, through an edit that leaves it alone", async () => {
    const onSubmit = renderEditor(STEPPED);

    // The base block's group is first; the variant's carries the same labels.
    expect((screen.getAllByLabelText("Prompt tokens above")[0] as HTMLInputElement).value).toBe("100000");
    fireEvent.change(screen.getAllByLabelText("Input ($/M)")[0]!, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(changeLines()).toEqual(["Input: $3.00/M → $4.00/M"]);
    await save();

    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.pricing?.inputPriceMicrosPerMillion).toBe(4_000_000n);
    expect(sent.pricing?.longContext).toEqual(step(6_000_000n));
    expect(sent.pricingVariants.fast?.pricing?.longContext).toEqual(step(12_000_000n));
  });

  it("adds a step from the filled group, each change on its own line", async () => {
    const onSubmit = renderEditor(SONNET);

    fireEvent.change(screen.getByLabelText("Prompt tokens above"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Input above ($/M)"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Output above ($/M)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Cache write above ($/M)"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Cache read above ($/M)"), { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(changeLines()).toEqual([
      "Prompt tokens above: — → 100,000",
      "Input above 100,000: — → $6.00/M",
      "Output above 100,000: — → $30.00/M",
      "Cache write above 100,000: — → $6.00/M",
      "Cache read above 100,000: — → $0.60/M",
    ]);
    await save();
    expect(onSubmit.mock.calls[0]![0].pricing?.longContext).toEqual(step(6_000_000n));
  });

  it("removes the step when every field of its group is emptied", async () => {
    const onSubmit = renderEditor(STEPPED);

    for (const label of ["Prompt tokens above", "Input above ($/M)", "Output above ($/M)", "Cache write above ($/M)", "Cache read above ($/M)"]) {
      fireEvent.change(screen.getAllByLabelText(label)[0]!, { target: { value: "" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(changeLines()[0]).toBe("Prompt tokens above: 100,000 → —");
    await save();
    expect(onSubmit.mock.calls[0]![0].pricing?.longContext).toBeUndefined();
    expect(onSubmit.mock.calls[0]![0].pricingVariants.fast?.pricing?.longContext).toEqual(step(12_000_000n));
  });

  it("refuses a group partly filled, with one error, and sends nothing", () => {
    const onSubmit = renderEditor(SONNET);

    fireEvent.change(screen.getByLabelText("Prompt tokens above"), { target: { value: "100000" } });
    fireEvent.change(screen.getByLabelText("Input above ($/M)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(screen.getByText("Fill every long-prompt field, or none.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Rate changes" })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("BaselineEditor's long-prompt rules", () => {
  const STEPPED = create(ModelPricingBaselineSchema, {
    ...SONNET,
    pricing: create(PricingBlockSchema, {
      inputPriceMicrosPerMillion: 3_000_000n,
      outputPriceMicrosPerMillion: 15_000_000n,
      longContext: step(6_000_000n),
    }),
    pricingVariants: {
      fast: create(PricingVariantSchema, {
        pricing: create(PricingBlockSchema, {
          inputPriceMicrosPerMillion: 6_000_000n,
          outputPriceMicrosPerMillion: 30_000_000n,
          longContext: step(12_000_000n),
        }),
      }),
    },
  });

  function fillBaseGroup(threshold: string, input = "6") {
    fireEvent.change(screen.getByLabelText("Prompt tokens above"), { target: { value: threshold } });
    fireEvent.change(screen.getByLabelText("Input above ($/M)"), { target: { value: input } });
    fireEvent.change(screen.getByLabelText("Output above ($/M)"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Cache write above ($/M)"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("Cache read above ($/M)"), { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  }

  it.each(["1.5", "0", "3000000000", "100k"])("refuses %s as the prompt length", (threshold) => {
    const onSubmit = renderEditor(SONNET);
    fillBaseGroup(threshold);
    expect(screen.getByText("Prompt tokens above must be a whole number above 0.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Rate changes" })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a long-prompt rate that is not a dollar amount", () => {
    renderEditor(SONNET);
    fillBaseGroup("100000", "six");
    expect(screen.getByText("The long-prompt input rate must be a non-negative dollar amount.")).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Rate changes" })).toBeNull();
  });

  it("names the variant whose group is partly filled", () => {
    renderEditor(STEPPED);
    // The variant's group is the second.
    fireEvent.change(screen.getAllByLabelText("Output above ($/M)")[1]!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByText('Variant "fast": Fill every long-prompt field, or none.')).toBeTruthy();
  });

  it("lists a moved threshold, and one rate moved inside a step, base and variant", () => {
    renderEditor(STEPPED);
    fireEvent.change(screen.getAllByLabelText("Prompt tokens above")[0]!, { target: { value: "150000" } });
    fireEvent.change(screen.getAllByLabelText("Output above ($/M)")[1]!, { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    expect(changeLines()).toEqual([
      "Prompt tokens above: 100,000 → 150,000",
      'Variant "fast" output above 100,000: $60.00/M → $70.00/M',
    ]);
  });
});
