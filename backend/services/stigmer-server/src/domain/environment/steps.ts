/**
 * The Environment domain's own steps.
 *
 *   - NormalizeEnvironment: an Environment with no networking, or networking
 *     of no type, is unrestricted, as Managed Agents reads an omitted field;
 *     listed hosts are stored lower case, with no trailing dot, each once
 *     (hosts.ts).
 *   - ValidateEnvironmentHosts: each listed host the grammar admits but the
 *     server refuses (an IP address, a single label, a cluster-internal or
 *     metadata name, the sandbox runtime's own services) is refused with
 *     INVALID_ARGUMENT naming it and the rule.
 *   - RefuseUnservableEnvironment: limited networking, or packages, that
 *     this server's sandbox driver cannot enforce or install is refused with
 *     FAILED_PRECONDITION when the Environment is saved, so an admin learns
 *     it once rather than every member meeting it at every conversation an
 *     organization default reaches (facts.ts unservableReason).
 *   - GuardEnvironmentUnreferenced: a delete is refused while an agent or a
 *     routine of the Environment's organization names it, or while it is the
 *     organization's default, naming each. Conversations do not hold it:
 *     each keeps its own resolved reference and is refused at its next turn
 *     instead. The scan is guard-unlisted.ts's, over the target's own
 *     organization; organization purge skips this step.
 */
import { create, fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Environment, EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import {
  EnvironmentNetworkingSchema,
  EnvironmentSpecSchema,
  NetworkingType,
} from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { EnvironmentSupport } from "../../sandbox/provisioner.js";
import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { unservableReason } from "./facts.js";
import { hostRefusal, normalizeHosts } from "./hosts.js";

type EnvironmentDesc = typeof EnvironmentSchema;
type DeleteDesc = typeof EnvironmentCommandController.method.delete.input;

export function newNormalizeEnvironmentStep(): PipelineStep<EnvironmentDesc> {
  return {
    name: "NormalizeEnvironment",
    execute(ctx: RequestContext<EnvironmentDesc>): void {
      const spec = (ctx.newState.spec ??= create(EnvironmentSpecSchema));
      const networking = (spec.networking ??= create(EnvironmentNetworkingSchema));
      if (networking.type === NetworkingType.networking_type_unspecified) {
        networking.type = NetworkingType.unrestricted;
      }
      networking.allowedHosts = normalizeHosts(networking.allowedHosts);
    },
  };
}

export function newValidateEnvironmentHostsStep(): PipelineStep<EnvironmentDesc> {
  return {
    name: "ValidateEnvironmentHosts",
    execute(ctx: RequestContext<EnvironmentDesc>): void {
      for (const host of ctx.newState.spec?.networking?.allowedHosts ?? []) {
        const refusal = hostRefusal(host);
        if (refusal !== undefined) {
          throw invalidArgumentError(refusal);
        }
      }
    },
  };
}

export function newRefuseUnservableEnvironmentStep(
  support: EnvironmentSupport,
): PipelineStep<EnvironmentDesc> {
  return {
    name: "RefuseUnservableEnvironment",
    execute(ctx: RequestContext<EnvironmentDesc>): void {
      const reason = unservableReason(support, ctx.newState);
      if (reason !== undefined) {
        throw failedPreconditionError(reason);
      }
    },
  };
}

/** The refusal: the Environment and everything that names it. */
export function stillNamedMessage(slug: string, referrers: readonly string[]): string {
  return `environment '${slug}' is still used by ${referrers.join(", ")}; remove it from them first`;
}

/**
 * What a chain left in its context for a step or handler to read. A missing
 * value is a chain built wrong (a step removed or reordered), so it fails
 * loudly as INTERNAL rather than answering with nothing (Score's controller
 * keeps the same rule).
 */
export function chainResult<T>(value: unknown, what: string): T {
  if (value === undefined) {
    throw internalError(new Error(`${what} not found in context`), `${what} not found in context`);
  }
  return value as T;
}

export function newGuardEnvironmentUnreferencedStep(store: Store): PipelineStep<DeleteDesc> {
  return {
    name: "GuardEnvironmentUnreferenced",
    async execute(ctx: RequestContext<DeleteDesc>): Promise<void> {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Environment | undefined;
      // The load step runs first; without it the chain is built wrong.
      const { org, slug, id } = chainResult<NonNullable<Environment["metadata"]>>(existing?.metadata, "the loaded Environment");
      const referrers: string[] = [];
      try {
        const agents: string[] = [];
        for (const raw of await store.listResources(ApiResourceKind.agent)) {
          const agent = fromBinary(AgentSchema, raw);
          if (agent.metadata?.org === org && agent.spec?.environmentRef?.id === id) {
            agents.push(`agent '${agent.metadata.slug}'`);
          }
        }
        const routines: string[] = [];
        for (const raw of await store.listResources(ApiResourceKind.routine)) {
          const routine = fromBinary(RoutineSchema, raw);
          if (routine.metadata?.org === org && routine.spec?.agent?.environmentRef?.id === id) {
            routines.push(`routine '${routine.metadata.slug}'`);
          }
        }
        referrers.push(...agents.sort(), ...routines.sort());
        if (await isOrganizationDefault(store, org, id)) {
          referrers.push("the organization's default");
        }
      } catch (error) {
        throw internalError(error, "failed to read what names the environment");
      }
      if (referrers.length > 0) {
        throw failedPreconditionError(stillNamedMessage(slug, referrers));
      }
    },
  };
}

async function isOrganizationDefault(store: Store, org: string, id: string): Promise<boolean> {
  try {
    const organization = await store.getResource(ApiResourceKind.organization, org, OrganizationSchema);
    return organization.spec?.preferences?.defaultEnvironmentRef?.id === id;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw error;
  }
}
