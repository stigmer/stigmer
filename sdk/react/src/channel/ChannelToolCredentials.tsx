"use client";

import { useCallback } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { useChannelToolReadiness } from "./useChannelToolReadiness.js";

/** Props for {@link ChannelToolCredentials}. */
export interface ChannelToolCredentialsProps {
  /** The agent the channel serves (drives the readiness check). */
  readonly agent: Agent;
  /** Organization the environments are listed from (the channel's org). */
  readonly org: string;
  /** Currently bound environment references, in merge order. */
  readonly value: readonly ResourceRef[];
  /** Called when the binding list changes. */
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

/**
 * The channel's credential-binding surface: explanatory copy, the
 * org-shared environment picker, and the readiness hint. Shared by the
 * connect dialog (binding at connect time) and the channel card's
 * credentials dialog (editing later) so the two surfaces can never
 * drift — the {@link ShareAgentDialog} ToolCredentialsSection pattern,
 * applied to channels.
 */
export function ChannelToolCredentials({
  agent,
  org,
  value,
  onChange,
  disabled = false,
  enabled = true,
}: ChannelToolCredentialsProps) {
  // Only org-shared environments are usable by channel executions (the
  // runtime merge skips private ones), so offering others would bind
  // credentials that silently never apply.
  const onlyOrgShared = useCallback(
    (env: Environment) =>
      env.metadata?.visibility === ApiResourceVisibility.visibility_org,
    [],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      <p className="stg:text-[0.65rem] stg:text-muted-foreground">
        Environments whose values workspace conversations can use — bind
        one holding the credentials this agent&apos;s tools need (a
        read-only token is safest). Only environments shared with your
        organization can be bound; share one first in Settings &rarr;
        Environments. Secret values stay hidden from workspace members
        either way.
      </p>
      <EnvironmentPicker
        org={org}
        value={value}
        onChange={onChange}
        disabled={disabled}
        filterEnvironment={onlyOrgShared}
      />
      <ChannelToolReadinessHint agent={agent} enabled={enabled} value={value} />
    </div>
  );
}

/**
 * Pre-flight hint for tool-using agents: channel conversations receive
 * credentials only from the channel's own environment bindings, so a
 * tool-using agent with no bindings (`needs-credentials`) or a binding
 * that is still private (`blocked`) will refuse the first message that
 * needs a tool. Renders nothing when there is nothing to fix.
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
        no credentials are bound to this channel. Bind an org-shared
        environment above.
      </p>
    );
  }

  if (readiness.status !== "blocked") {
    return null;
  }

  const envList = readiness.privateEnvironments.join(", ");
  const plural = readiness.privateEnvironments.length > 1;

  return (
    <p className="stg:text-xs stg:text-warning" role="status">
      Workspace conversations can&apos;t use this agent&apos;s tools yet:
      the environment{plural ? "s" : ""}{" "}
      <span className="stg:font-medium">{envList}</span>{" "}
      {plural ? "are" : "is"} private. Share {plural ? "them" : "it"} with
      your organization (Settings &rarr; Environments) so channel
      conversations can use the credentials. Secret values stay hidden
      either way.
    </p>
  );
}
