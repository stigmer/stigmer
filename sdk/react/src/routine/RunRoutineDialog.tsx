"use client";

import { useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
import { DialogShell } from "../internal/DialogShell.js";

/**
 * The contract's bound on a fire's note: io.proto pins
 * `FireRoutineInput.text` to 65,536 characters. The field stops there; the
 * server's bound stays the rule and answers in its own words.
 */
export const FIRE_TEXT_MAX_LEN = 65536;

/** Props for {@link RunRoutineDialog}. */
export interface RunRoutineDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The routine's display name, shown under the title. */
  readonly routineName: string;
  /**
   * Starts the run with the note, or with none when the field is blank.
   * The dialog closes when the promise resolves and stays open, keeping the
   * note, when it rejects (the fire hook has already said why).
   */
  readonly onStart: (text: string | undefined) => Promise<void>;
  /**
   * The routine is disabled: starting it also switches it back on, and the
   * copy says so.
   * @default false
   */
  readonly enableFirst?: boolean;
  /**
   * When `false`, renders as an in-flow open dialog instead of a top-layer
   * modal (documentation demos, visual tests).
   * @default true
   */
  readonly modal?: boolean;
}

/**
 * Run now for a routine: a real run, started immediately, with an optional
 * note for the agent ("Sentry alert SEN-4521 fired, see the link").
 *
 * The note is what another system sends over the API, offered to a person
 * too: the server places it after the routine's saved message, fenced as
 * information from whoever started the run, never as instructions. A
 * blank note sends none, so the run gets the routine's message alone.
 *
 * Every console surface that starts a routine (the detail header, the
 * disabled banner's Enable & run, the list row) opens this one dialog, so
 * starting a routine reads the same everywhere. Hosts gate it on
 * `can_fire`; the server re-checks.
 */
export function RunRoutineDialog({
  open,
  onOpenChange,
  routineName,
  onStart,
  enableFirst = false,
  modal = true,
}: RunRoutineDialogProps) {
  // Instance-scoped id: a list mounts one dialog per row.
  const titleId = useId();

  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      width="md"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open, so each opening starts blank. */}
      {open && (
        <RunRoutineDialogBody
          titleId={titleId}
          routineName={routineName}
          enableFirst={enableFirst}
          onStart={onStart}
          onClose={handleClose}
        />
      )}
    </DialogShell>
  );
}

function RunRoutineDialogBody({
  titleId,
  routineName,
  enableFirst,
  onStart,
  onClose,
}: {
  readonly titleId: string;
  readonly routineName: string;
  readonly enableFirst: boolean;
  readonly onStart: (text: string | undefined) => Promise<void>;
  readonly onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [isStarting, setIsStarting] = useState(false);

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    try {
      await onStart(note.trim() === "" ? undefined : note);
      onClose();
    } catch {
      // The fire hook toasts the refusal; the note stays for a retry.
    } finally {
      setIsStarting(false);
    }
  }, [note, onClose, onStart]);

  return (
    <form
      className="stg:flex stg:flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void handleStart();
      }}
    >
      <div className="stg:border-b stg:border-border stg:px-5 stg:py-4">
        <h2 id={titleId} className="stg:text-sm stg:font-semibold stg:text-foreground">
          {enableFirst ? "Enable and run this routine now?" : "Run this routine now?"}
        </h2>
        <p className="stg:mt-0.5 stg:truncate stg:text-xs stg:text-muted-foreground">
          {routineName}
        </p>
      </div>

      <div className="stg:space-y-4 stg:px-5 stg:py-4">
        <p className="stg:text-xs stg:text-muted-foreground">
          {enableFirst
            ? "This routine is disabled. Enabling it lets it fire on its schedule again, and starts one real run now so you can see the result. You can disable it again afterwards."
            : "This starts a real run now, outside its schedule. The run is recorded in this routine's history."}
        </p>

        <div className="stg:space-y-1">
          <label htmlFor={`${titleId}-note`} className={labelClasses}>
            Note for this run{" "}
            <span className="stg:font-normal stg:text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id={`${titleId}-note`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={FIRE_TEXT_MAX_LEN}
            rows={4}
            disabled={isStarting}
            placeholder="Sentry alert SEN-4521 fired, see the link"
            className={inputClasses}
          />
          <p className={hintClasses}>
            The agent receives it after the routine&rsquo;s message, marked as
            information from you, not instructions.
          </p>
        </div>
      </div>

      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-5 stg:py-3">
        <Button variant="ghost" size="sm" type="button" onClick={onClose} disabled={isStarting}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="submit" disabled={isStarting}>
          {enableFirst ? "Enable & run" : "Start run"}
        </Button>
      </div>
    </form>
  );
}

const labelClasses = "stg:block stg:text-xs stg:font-medium stg:text-foreground";

const hintClasses = "stg:text-2xs stg:text-muted-foreground";

const inputClasses = cn(
  "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);
