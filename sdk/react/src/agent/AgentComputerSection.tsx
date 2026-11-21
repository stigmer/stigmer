"use client";

/**
 * The "Computer" section of the agent detail view: one switch saying
 * whether the agent's conversations have a computer (`AgentSpec.computer`),
 * and one sentence on what that means.
 *
 * The switch saves at once (a single yes/no, as the routine's on/off
 * switch does): flipping it writes `spec.computer` alone through the host's
 * `onSave`, shows "Saving" while the write is in flight, and on a refusal
 * springs back to the stored value with the server's sentence under it.
 * The rules (no Bash, no hooks, no Environment, no plugin with hooks or a
 * local program, no subagent with a computer) live in the server alone;
 * this section never judges them, so the two can't drift.
 *
 * On the Claude harness the switch is locked on, with why: that harness
 * always runs with a computer. A reader sees the switch disabled, in the
 * state the agent has.
 *
 * Pinned by `__tests__/AgentComputerSection.test.tsx`.
 */

import { useId, useState } from "react";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { Section } from "../resource-detail/Section.js";
import { Switch } from "../switch/Switch.js";
import { COMPUTER_COPY, agentHasComputer, computerLocked } from "./computer.js";

/** Props for {@link AgentComputerSection}. */
export interface AgentComputerSectionProps {
  readonly spec: AgentSpec | undefined;
  readonly editable: boolean;
  /** The server's message for the last failed save of this section. */
  readonly error?: string;
  /** Persist `spec.computer`; resolves `true` on success. */
  readonly onSave: (computer: Computer) => Promise<boolean>;
  /** Called when a save starts, so a stale error from an earlier attempt clears. */
  readonly onEditStart?: () => void;
}

/**
 * Shows whether an agent has a computer, and switches it when `editable`.
 *
 * @example
 * ```tsx
 * <AgentComputerSection
 *   spec={agent.spec}
 *   editable
 *   error={errorFor("computer")}
 *   onSave={(computer) => saveField("computer", computer)}
 * />
 * ```
 */
export function AgentComputerSection({ spec, editable, error, onSave, onEditStart }: AgentComputerSectionProps) {
  const id = useId();
  const [pending, setPending] = useState<boolean | null>(null);
  const locked = computerLocked(spec);
  const stored = agentHasComputer(spec);
  const checked = locked || (pending ?? stored);

  const change = async (next: boolean) => {
    onEditStart?.();
    setPending(next);
    try {
      await onSave(next ? Computer.REQUIRED : Computer.NONE);
    } finally {
      setPending(null);
    }
  };

  return (
    <Section title="Computer">
      <div className="stg:flex stg:flex-col stg:gap-2 stg:p-3">
        <div className="stg:flex stg:items-start stg:gap-3">
          <Switch
            id={`${id}-switch`}
            checked={checked}
            onCheckedChange={(next) => void change(next)}
            disabled={!editable || locked || pending !== null}
            aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-hint`}
          />
          <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-0.5">
            <div className="stg:flex stg:items-center stg:gap-2">
              <label id={`${id}-label`} htmlFor={`${id}-switch`} className="stg:text-sm stg:text-foreground">
                {COMPUTER_COPY.label}
              </label>
              {locked && (
                <span className="stg:rounded-sm stg:border stg:border-border stg:px-1.5 stg:text-2xs stg:text-muted-foreground">
                  {COMPUTER_COPY.lockedBadge}
                </span>
              )}
              {pending !== null && (
                <span className="stg:text-2xs stg:text-muted-foreground" role="status">
                  {COMPUTER_COPY.saving}
                </span>
              )}
            </div>
            <p id={`${id}-hint`} className="stg:text-xs stg:text-muted-foreground">
              {locked ? COMPUTER_COPY.locked : checked ? COMPUTER_COPY.on : COMPUTER_COPY.off}
            </p>
          </div>
        </div>
        {error && (
          <p className="stg:text-xs stg:text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Section>
  );
}
