/**
 * Pins BaselineEditor's confirm step for a rate edit: after the operator
 * changes a rate and asks to review, the step lists each moving rate as its
 * old value struck through beside the new one, says the new rates apply
 * forward only, and sends nothing until the revision is applied.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  ModelPricingBaselineSchema,
  ModelPricingBaselineStatus,
  PricingBlockSchema,
} from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { BaselineEditor } from "../BaselineEditor";

const SONNET = create(ModelPricingBaselineSchema, {
  baselineId: "bl-1",
  modelId: "claude-sonnet-4-6",
  provider: "anthropic",
  harness: "native",
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
