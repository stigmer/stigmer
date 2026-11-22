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
 * Without a computer, the server's warnings of the agent's last save
 * (`AgentStatus.warnings`: a skill whose scripts it can't run) follow the
 * sentence, one quiet line each, the skill's name set in mono. They are the
 * server's words, shown as they come; the switch on hides them, as a
 * computer runs the scripts.
 *
 * Pinned by `__tests__/AgentDetailView.computer.test.tsx`.
 */

import { useId, useState } from "react";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentWarning } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { Section } from "../resource-detail/Section.js";
import { Switch } from "../switch/Switch.js";
import { CircleAlert } from "lucide-react";
import { COMPUTER_COPY, agentHasComputer, computerLocked } from "./computer.js";

/** Props for {@link AgentComputerSection}. */
export interface AgentComputerSectionProps {
  readonly spec: AgentSpec | undefined;
  /** The server's warnings of the agent's last save (`AgentStatus.warnings`); shown only without a computer. */
  readonly warnings?: readonly AgentWarning[];
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
export function AgentComputerSection({ spec, warnings = [], editable, error, onSave, onEditStart }: AgentComputerSectionProps) {
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
        {!checked && warnings.length > 0 && (
          <ul className="stg:ml-11 stg:flex stg:list-none stg:flex-col stg:gap-1 stg:p-0" aria-label={COMPUTER_COPY.warningsLabel}>
            {warnings.map((warning, index) => (
              <li key={`${warning.kind}:${warning.skill}:${index}`} className="stg:flex stg:items-baseline stg:gap-2 stg:text-xs stg:text-muted-foreground">
                <CircleAlert aria-hidden className="stg:relative stg:top-px stg:size-3 stg:shrink-0" />
                <span>
                  {warning.skill ? <SkillNamed message={warning.message} skill={warning.skill} /> : warning.message}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="stg:text-xs stg:text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </Section>
  );
}

/** A warning's sentence with its skill's name, where the sentence quotes it, set in mono. */
function SkillNamed({ message, skill }: { readonly message: string; readonly skill: string }) {
  const quoted = `'${skill}'`;
  const at = message.indexOf(quoted);
  if (at === -1) return <>{message}</>;
  return (
    <>
      {message.slice(0, at)}
      <span className="stg:font-mono stg:text-foreground">{skill}</span>
      {message.slice(at + quoted.length)}
    </>
  );
}
