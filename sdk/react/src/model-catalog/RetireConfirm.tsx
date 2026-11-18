"use client";

import { useState } from "react";
import { getUserMessage } from "@stigmer/client";
import type { ModelPricingBaseline } from "@stigmer/apis/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { Button } from "../button/index.js";
import { DialogBody, DialogFooter, DialogHeader, DialogShell } from "../internal/DialogShell.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Field, FieldError, TextInput } from "../internal/form/index.js";

// ---------------------------------------------------------------------------
// RetireConfirm — typed confirmation for retiring a catalog entry (a
// destructive, billing-visible action), as a dialog over the model's record.
// Typed, so it stays a small form inside the dialog rather than a yes or no.
// Internal to the model-catalog module: rendered by ModelCatalogConsole,
// never exported from the barrel.
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
  const close = () => {
    if (!isSubmitting) onCancel();
  };

  return (
    <DialogShell open onOpenChange={(open) => !open && close()} width="sm">
      <DialogHeader
        title={`Retire ${target.displayName || target.modelId}?`}
        description="New conversations can't pick it. Runs already on it finish."
        onClose={close}
        closeDisabled={isSubmitting}
      />
      <DialogBody>
        <Field label="Type the model id to confirm">
          <TextInput
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={target.modelId}
            disabled={isSubmitting}
            className="stg:font-mono"
            autoComplete="off"
          />
        </Field>
        <Field label="Why" optional>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} disabled={isSubmitting} />
        </Field>
        {submitError && <FieldError>{getUserMessage(submitError)}</FieldError>}
      </DialogBody>
      <DialogFooter>
        <Button size="sm" variant="ghost" disabled={isSubmitting} onClick={close}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={!confirmed || isSubmitting}
          aria-busy={isSubmitting || undefined}
          icon={isSubmitting ? <SpinnerIcon size={14} /> : undefined}
          onClick={() => onConfirm(target, note.trim()).catch(() => undefined)}
        >
          Retire
        </Button>
      </DialogFooter>
    </DialogShell>
  );
}
