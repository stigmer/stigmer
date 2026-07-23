"use client";

import { useState } from "react";
import { getUserMessage } from "@stigmer/sdk";
import type { ModelPricingBaseline } from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { INPUT_CLASSES } from "../internal/form-primitives.js";

// ---------------------------------------------------------------------------
// RetireConfirm — typed confirmation for retiring a catalog entry (a
// destructive, billing-visible action). Internal to the billing module:
// rendered by PricingGovernanceConsole and ModelCatalogPanel, never
// exported from the barrel.
// ---------------------------------------------------------------------------

export function RetireConfirm({
  target,
  isSubmitting,
  submitError,
  onConfirm,
  onCancel,
}: {
  readonly target: ModelPricingBaseline;
  readonly isSubmitting: boolean;
  readonly submitError: Error | null;
  readonly onConfirm: (target: ModelPricingBaseline, revisionNote: string) => Promise<void>;
  readonly onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const confirmed = typed === target.modelId;

  return (
    <div className="space-y-2 rounded-lg border border-destructive bg-card px-3 py-3">
      <h4 className="text-xs font-semibold text-foreground">
        Retire {target.displayName || target.modelId}?
      </h4>
      <p className="text-xs text-muted-foreground">
        The model disappears from every price surface (billing lookups, model
        pickers, the served registry) and any active pricing overrides on it are
        archived. The revision history is kept, and the key can be revived by a
        later upsert. Type <span className="font-medium text-foreground">{target.modelId}</span>{" "}
        to confirm.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          className={INPUT_CLASSES}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={target.modelId}
          disabled={isSubmitting}
          aria-label="Type the model id to confirm retirement"
        />
        <input
          className={INPUT_CLASSES}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Reason (audit trail)"
          disabled={isSubmitting}
        />
      </div>
      {submitError && (
        <p className="text-destructive text-xs" role="alert">
          {getUserMessage(submitError)}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={!confirmed || isSubmitting}
          onClick={() => onConfirm(target, note.trim()).catch(() => undefined)}
        >
          {isSubmitting ? "Retiring…" : "Retire model"}
        </Button>
        <Button size="sm" variant="outline" disabled={isSubmitting} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
