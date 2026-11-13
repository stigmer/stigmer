"use client";

import { useCallback, useEffect } from "react";
import type { Message } from "@bufbuild/protobuf";
import { DialogShell } from "../internal/DialogShell.js";
import { getUserMessage, type AppliedManifest } from "@stigmer/client";
import { toast } from "../feedback/toast.js";
import { keptChangeSentences } from "./keptChanges.js";
import { Notice } from "../internal/surface/Notice.js";
import { RedactedSecretsNotice } from "./RedactedSecretsNotice.js";
import { useEditResourceYaml } from "./useEditResourceYaml.js";
import { YamlEditor } from "./YamlEditor.js";
import { Button } from "../button/Button.js";


/** Props for {@link EditResourceYamlDialog}. */
export interface EditResourceYamlDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog should open or close. */
  readonly onOpenChange: (open: boolean) => void;
  /**
   * The resource to edit, as returned by the server. `null` while loading —
   * the dialog shows the editor as soon as the resource arrives.
   */
  readonly resource: Message | null;
  /** Called after a successful apply. Use for refetching or navigation. */
  readonly onApplied?: (result: AppliedManifest) => void;
}

/**
 * Modal dialog for editing a resource as YAML and applying the changes —
 * the kind-agnostic "Edit YAML" experience for detail pages and panels.
 *
 * Steps:
 * 1. The resource is serialized to canonical YAML (system-managed state
 *    stripped) and seeded into a CodeMirror editor
 * 2. Every edit is validated against the kind's generated proto schema;
 *    errors render inline with the exact schema complaint
 * 3. A live summary states what applying will do ("update X", "create Y",
 *    "rename X to Y"), resolved by the lookup the apply makes
 * 4. Apply calls `stigmer.manifest.apply()`: the server finds the resource
 *    by its id, then its slug, and a changed slug renames it
 *
 * Redacted secret values (`***REDACTED***`) are explained inline: applying
 * them preserves the stored secrets (the server's marker contract).
 *
 * Uses the native `<dialog>` element for built-in focus trapping, Escape
 * key handling, and backdrop — consistent with {@link ConfirmDialog}.
 *
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * function EditAgentButton({ slug }: { slug: string }) {
 *   const { agent, refetch } = useAgent("acme", slug);
 *   const [editOpen, setEditOpen] = useState(false);
 *   return (
 *     <>
 *       <button onClick={() => setEditOpen(true)}>Edit YAML</button>
 *       <EditResourceYamlDialog open={editOpen} onOpenChange={setEditOpen} resource={agent} onApplied={refetch} />
 *     </>
 *   );
 * }
 * ```
 */
export function EditResourceYamlDialog({
  open,
  onOpenChange,
  resource,
  onApplied,
}: EditResourceYamlDialogProps) {
  const edit = useEditResourceYaml({ resource });
  const { reset } = edit;

  // Discard stale edits from a previous session when the dialog opens.
  useEffect(() => {
    if (open) reset();
  }, [open, reset]);

  const handleApply = useCallback(async () => {
    try {
      const result = await edit.apply();
      if (!result) return;
      toast.success(`${result.displayName} "${result.name}" applied`);
      onOpenChange(false);
      onApplied?.(result);
    } catch {
      // error state is set by the hook and rendered inline
    }
  }, [edit, onOpenChange, onApplied]);

  const canApply =
    edit.validation.status === "valid" && edit.isDirty && !edit.isApplying;

  return (
    <DialogShell open={open} onOpenChange={onOpenChange} width="3xl" aria-label="Edit YAML">
      <div className="stg:flex stg:flex-col stg:gap-4 stg:p-6">
        {/* Header */}
        <div className="stg:flex stg:flex-col stg:gap-1">
          <h3 className="stg:text-base stg:font-semibold stg:text-foreground">Edit YAML</h3>
          <p className="stg:text-sm stg:text-muted-foreground">
            Edit the resource definition and apply. Changes are validated
            against the resource schema as you type.
          </p>
        </div>

        {/* Editor */}
        {resource ? (
          // CodeMirror loads when the editor first renders, so only once the dialog opens.
          <YamlEditor
            value={edit.yaml}
            onChange={edit.setYaml}
            className="stg:h-80"
          />
        ) : (
          <EditorLoading label="Loading resource…" />
        )}

        {edit.hasRedactedSecrets && <RedactedSecretsNotice />}

        {/* Validation error */}
        {edit.validation.status === "invalid" && (
          <Notice tone="failed" headline={edit.validation.message} />
        )}

        {/* Apply error — the server's refusal rendered verbatim, with an
            acknowledge-and-retry affordance: the operator reads the
            guard, edits or decides, and re-applies without reopening
            the dialog. */}
        {edit.error && (
          <Notice
            tone="failed"
            headline="Couldn't apply the YAML."
            act={
              edit.validation.status === "valid"
                ? { label: "Try again", onClick: handleApply, busy: edit.isApplying }
                : undefined
            }
            link={{ label: "Dismiss", onClick: edit.clearError }}
          >
            <p className="stg:m-0 stg:break-words">{getUserMessage(edit.error)}</p>
          </Notice>
        )}

        {/* Footer: target summary + actions */}
        <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
          <p className="stg:text-xs stg:text-muted-foreground" aria-live="polite">
            {targetSummary(edit.validation, edit.isDirty, edit.target)}
          </p>
          <div className="stg:flex stg:gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={edit.isApplying}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={!canApply}>
              {edit.isApplying ? "Applying…" : "Apply changes"}
            </Button>
          </div>
        </div>
      </div>
    </DialogShell>
  );
}

function targetSummary(
  validation: ReturnType<typeof useEditResourceYaml>["validation"],
  isDirty: boolean,
  target: ReturnType<typeof useEditResourceYaml>["target"],
): string {
  if (validation.status !== "valid") return "";
  if (!isDirty) return "No changes yet.";
  if (target === null) return "Checking what applying will do…";
  const displayName = validation.document.handler.displayName;
  switch (target.action) {
    case "update":
      return [`Applying will update ${target.slug}.`, ...keptChangeSentences(displayName, target)].join(" ");
    case "create":
      return `Applying will create ${target.slug}.`;
    case "rename":
      return [
        `Applying will rename ${target.from} to ${target.slug}.`,
        ...keptChangeSentences(displayName, { slugKept: false, visibilityKept: target.visibilityKept }),
      ].join(" ");
    case "unknown":
      return `Applying will create or update ${target.slug}.`;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over EditYamlTarget; the hook answers only the arms above */
    default: {
      const unhandled: never = target;
      return String(unhandled);
    }
  }
}

function EditorLoading({ label }: { readonly label: string }) {
  return (
    <div className="stg:flex stg:h-80 stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-border stg:bg-muted stg:text-sm stg:text-muted-foreground">
      {label}
    </div>
  );
}
