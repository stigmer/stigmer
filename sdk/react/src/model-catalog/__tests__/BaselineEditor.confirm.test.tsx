/**
 * Pins BaselineEditor's confirm step for a rate edit: after the operator
 * changes a rate and asks to review, the step lists each moving rate as its
 * old value struck through beside the new one, says the new rates apply
 * forward only, and sends nothing until the revision is applied. And an
 * edit keeps what the form cannot show: the long-prompt price step on the
 * base block and on each variant (stigmer#3131), which a block rebuilt field
 * by field would otherwise drop.
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

afterEach(cleanup);

describe("BaselineEditor confirm step", () => {
  it("lists the moving rate old to new and says new rates apply forward only", () => {
    const onSubmit = vi.fn(async () => undefined);
    render(
      <BaselineEditor
        initial={SONNET}
        isSubmitting={false}
        submitError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Input"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));

    const table = screen.getByRole("table", { name: "Rate changes" });
    const rows = within(table).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual(["Input: $3.00/M → $4.00/M"]);
    expect(within(table).getByText(/New rates govern charges from the moment this revision is applied/)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("BaselineEditor keeps the long-prompt step (#3131)", () => {
  const step = (inputMicros: bigint) =>
    create(LongContextPricingSchema, {
      thresholdTokens: 100_000,
      inputPriceMicrosPerMillion: inputMicros,
      outputPriceMicrosPerMillion: inputMicros * 5n,
      cacheWritePriceMicrosPerMillion: inputMicros,
      cacheReadPriceMicrosPerMillion: inputMicros / 10n,
    });
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

  it("an edit keeps the step, base and variant", async () => {
    const onSubmit = vi.fn(async (_baseline: ModelPricingBaseline, _note: string) => undefined);
    render(
      <BaselineEditor
        initial={STEPPED}
        isSubmitting={false}
        submitError={null}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // The base block's Input comes first; the variant's carries the same label.
    fireEvent.change(screen.getAllByLabelText("Input")[0]!, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Apply revision" }));
    });

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.pricing?.inputPriceMicrosPerMillion).toBe(4_000_000n);
    expect(sent.pricing?.longContext).toEqual(step(6_000_000n));
    expect(sent.pricingVariants.fast?.pricing?.longContext).toEqual(step(12_000_000n));
  });
});
