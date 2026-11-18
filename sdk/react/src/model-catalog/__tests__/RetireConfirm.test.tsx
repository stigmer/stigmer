/**
 * Retiring a catalog model: a typed dialog over its record. Retire waits for
 * the model id typed exactly, sends the reason typed under it, and Escape
 * leaves without retiring.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { ModelPricingBaselineSchema } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { RetireConfirm } from "../RetireConfirm";

afterEach(cleanup);

const OPUS = create(ModelPricingBaselineSchema, { modelId: "claude-opus-4.8", displayName: "Claude Opus 4.8" });

function renderRetire() {
  const onConfirm = vi.fn(async () => undefined);
  const onCancel = vi.fn();
  render(<RetireConfirm target={OPUS} isSubmitting={false} submitError={null} onConfirm={onConfirm} onCancel={onCancel} />);
  return { onConfirm, onCancel };
}

describe("RetireConfirm", () => {
  it("retires once the model id is typed, with the reason typed under it", () => {
    const { onConfirm } = renderRetire();
    const retire = screen.getByRole("button", { name: "Retire" });
    expect(retire).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Type the model id to confirm"), { target: { value: "claude-opus-4.8" } });
    fireEvent.change(screen.getByLabelText(/^Why/), { target: { value: " Replaced by Claude Opus 5 " } });
    fireEvent.click(retire);
    expect(onConfirm).toHaveBeenCalledWith(OPUS, "Replaced by Claude Opus 5");
  });

  it("leaves without retiring on Escape", () => {
    const { onConfirm, onCancel } = renderRetire();
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
