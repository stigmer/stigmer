"use client";

/**
 * The channel's vault surface: explanatory copy, the vault picker, and the
 * readiness hint. Shared by the connect dialog (naming vaults at connect
 * time) and the channel card's credentials dialog (editing later) so the
 * two surfaces never drift — the share dialog's pattern, applied to
 * channels.
 *
 * A channel's conversations have no person, so they use only the vaults
 * the channel names, never anyone's My vault; the picker offers shared
 * vaults only.
 */
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { VaultPicker } from "../vault/VaultPicker.js";
import { useChannelToolReadiness } from "./useChannelToolReadiness.js";

/** Props for {@link ChannelToolCredentials}. */
export interface ChannelToolCredentialsProps {
  /** The agent the channel serves (drives the readiness check). */
  readonly agent: Agent;
  /** Organization the vaults are listed from (the channel's org). */
  readonly org: string;
  /** Currently named vault references, in order. */
  readonly value: readonly ResourceRef[];
  /** Called when the list changes. */
  readonly onChange: (refs: ResourceRef[]) => void;
  /** Disable all interactions (e.g. while a save is in flight). */
  readonly disabled?: boolean;
  /**
   * Whether the channel serves traffic. A paused channel needs no
   * readiness warning — the hint stays silent when `false`.
   * @default true
   */
  readonly enabled?: boolean;
}

/** The channel's vault picker with its explanation and readiness hint. */
export function ChannelToolCredentials({
  agent,
  org,
  value,
  onChange,
  disabled = false,
  enabled = true,
}: ChannelToolCredentialsProps) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Shared vaults whose keys workspace conversations use — name one
        holding the keys this agent&apos;s tools need (a read-only token is
        safest). You can name only vaults you may use; create one in
        Settings &rarr; Vaults. Saved values stay hidden from everyone.
      </p>
      <VaultPicker org={org} value={value} onChange={onChange} disabled={disabled} />
      <ChannelToolReadinessHint agent={agent} enabled={enabled} value={value} />
    </div>
  );
}

/**
 * Pre-flight hint for tool-using agents: channel conversations use only
 * the channel's vaults, so a tool-using agent naming none
 * (`needs-credentials`) or naming one that cannot serve (`blocked`) will
 * refuse the first message that needs a tool. Renders nothing otherwise.
 */
function ChannelToolReadinessHint({
  agent,
  enabled,
  value,
}: {
  readonly agent: Agent;
  readonly enabled: boolean;
  readonly value: readonly ResourceRef[];
}) {
  const readiness = useChannelToolReadiness(agent, enabled, value);

  if (readiness.status === "needs-credentials") {
    return (
      <p className="stg:text-xs stg:text-warning" role="status">
        Workspace conversations can&apos;t use this agent&apos;s tools yet:
        this channel names no vault. Name a shared vault above.
      </p>
    );
  }

  if (readiness.status !== "blocked") {
    return null;
  }

  const plural = readiness.unusableVaults.length > 1;
  return (
    <p className="stg:text-xs stg:text-warning" role="status">
      Workspace conversations can&apos;t use this agent&apos;s tools yet:
      the vault{plural ? "s" : ""}{" "}
      <span className="stg:font-medium">{readiness.unusableVaults.join(", ")}</span>{" "}
      {plural ? "are" : "is"} not a shared vault you can read. Name a shared
      vault instead (Settings &rarr; Vaults).
    </p>
  );
}
