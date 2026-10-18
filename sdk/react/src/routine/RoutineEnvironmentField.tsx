"use client";

/**
 * The Environment a routine's conversations run in: the routine's own
 * choice, else its agent's default, else the organization's. The field is
 * the shared `EnvironmentPicker`, its first row what applies without the
 * routine's own ("Default: data-science (the agent's default)"), read from
 * the routine's agent as it is now and the organization's preferences, the
 * order the server resolves at each fire. Used by the routine's create
 * form and by its page's inline editor.
 */
import { useCallback, useMemo } from "react";
import type { ResourceRef } from "@stigmer/client";
import { useRunAgentSpec } from "../agent/useRunAgentSpec.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { inheritedRowLabel } from "../environment/copy.js";
import { resolveEnvironmentChoice } from "../environment/resolve.js";
import { environmentName, useEnvironmentList } from "../environment/useEnvironmentList.js";
import { useOrganization } from "../organization/useOrganization.js";

/** Props for {@link RoutineEnvironmentField}. */
export interface RoutineEnvironmentFieldProps {
  /** The routine's organization id: its Environments are listed, and its default read. */
  readonly org: string;
  /** The routine's agent, whose default the first row names; `null` before one is picked. */
  readonly agentRef: ResourceRef | null;
  /** The routine's own choice, or `undefined` to leave it to the defaults. */
  readonly value: ResourceRef | undefined;
  readonly onChange: (ref: ResourceRef | undefined) => void;
  readonly disabled?: boolean;
  /** Accessible name of the select. @default "Environment" */
  readonly label?: string;
  readonly className?: string;
}

/** What applies to a routine's conversations with no choice of its own, named as a person knows it. */
export function useRoutineEnvironmentDefault(org: string | null, agentRef: ResourceRef | null) {
  const { spec } = useRunAgentSpec(agentRef);
  const { organization } = useOrganization(org);
  const { environments } = useEnvironmentList(org);
  const agentEnvironment = spec?.environmentRef;
  const organizationEnvironment = organization?.spec?.preferences?.defaultEnvironmentRef;
  const inherited = useMemo(
    () => resolveEnvironmentChoice({ agent: agentEnvironment, organization: organizationEnvironment }),
    [agentEnvironment, organizationEnvironment],
  );
  const nameOf = useCallback(
    (ref: { readonly slug: string }) => {
      const found = environments.find((environment) => environment.metadata?.slug === ref.slug);
      return found ? environmentName(found) : ref.slug;
    },
    [environments],
  );
  return useMemo(() => ({ inherited, nameOf }), [inherited, nameOf]);
}

/** The routine's Environment picker, its first row the inherited default. */
export function RoutineEnvironmentField({
  org,
  agentRef,
  value,
  onChange,
  disabled,
  label,
  className,
}: RoutineEnvironmentFieldProps) {
  const { inherited, nameOf } = useRoutineEnvironmentDefault(org, agentRef);
  return (
    <EnvironmentPicker
      org={org}
      value={value}
      onChange={onChange}
      defaultLabel={inheritedRowLabel(inherited, nameOf)}
      disabled={disabled}
      label={label}
      className={className}
    />
  );
}
