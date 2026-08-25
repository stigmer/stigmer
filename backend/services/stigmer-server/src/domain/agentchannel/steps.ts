/**
 * AgentChannel domain steps — ports pkg/domain/agentchannel/controller/
 * steps.go: channel defaults with the anti-probing ordering (same-org
 * invariant BEFORE the agent load), the write-time model-pin existence
 * rule (stigmer/stigmer#774), the WhatsApp BYO app_ref rules (DD-WA-2 /
 * T04 item 2), the install-state stamp, and the update immutability
 * rules.
 *
 * Proven by agentchannel.conformance.test.ts (CONFORMANCE_TARGET=local-ts)
 * and __tests__/agentchannel.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import type { AgentChannelSpec } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import {
  AgentChannelInstallState,
  AgentChannelStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  failedPreconditionError,
  internalError,
  invalidArgumentError,
  notFoundError,
} from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { unknownModelPinRefusal } from "../workflow/registry/pin-validation.js";
import type { ModelRegistryStore } from "../workflow/registry/model-registry-store.js";
import {
  AGENT_REF_SLUG_REQUIRED_MESSAGE,
  APP_REF_FROZEN_WHILE_INSTALLED_MESSAGE,
  APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE,
  APP_REF_SAME_ORG_MESSAGE,
  ORG_REQUIRED_MESSAGE,
  agentRefImmutableMessage,
  providerImmutableMessage,
  sameOrgInvariantMessage,
} from "./constants.js";

type AgentChannelDesc = typeof AgentChannelSchema;

/**
 * The write-time model-pin EXISTENCE rule (stigmer/stigmer#774) on a
 * channel's run_config — Go validateChannelModelPin: a typo'd pin used to
 * ride through opaquely and silently run (and bill) as Auto wherever the
 * channel serves. Validated against EVERY registry harness section (the
 * "" harness mode) because this edition stores channel specs without a
 * serving runtime (the DD-015 divergence posture). Go reads a
 * package-level registry; the TS registry is the domain-owned
 * ModelRegistryStore (workflow-family DD-A), passed explicitly. Shared by
 * create (ResolveChannelDefaults) and update (ValidateChannelUpdate).
 */
function validateChannelModelPin(
  registry: ModelRegistryStore,
  spec: AgentChannelSpec | undefined,
): void {
  const reason = unknownModelPinRefusal(
    registry,
    "spec.run_config.model_name",
    "",
    spec?.runConfig?.modelName ?? "",
  );
  if (reason !== "") {
    throw invalidArgumentError(reason);
  }
}

/**
 * ResolveChannelDefaults — Go resolveChannelDefaultsStep, the cloud
 * AgentChannelDefaultsResolver mirror whose error contracts this step
 * replicates byte-identically:
 *   1. Requires metadata.org (billing + credentials org, never inferred).
 *   2. Requires spec.agent_ref.slug; normalizes agent_ref.org (empty
 *      means same-org).
 *   3. Enforces the same-org invariant BEFORE the agent load, so a
 *      cross-org request cannot probe another org's slugs through this
 *      path.
 *   4. Validates the model pin and the WhatsApp BYO app_ref rules.
 *   5. Loads the referenced agent — a nonexistent agent is refused with
 *      the same NOT_FOUND a direct agent lookup would produce (T09).
 *
 * Deliberately NO slug default from the agent (unlike the share's
 * canonical-slug rule): channels are N-per-agent across providers, so no
 * single channel is "the" canonical one. Resolution is idempotent, so the
 * apply pipeline running it before the create pipeline re-runs it is
 * harmless.
 */
export function newResolveChannelDefaultsStep(
  store: Store,
  registry: ModelRegistryStore,
): PipelineStep<AgentChannelDesc> {
  return {
    name: "ResolveChannelDefaults",
    async execute(ctx: RequestContext<AgentChannelDesc>): Promise<void> {
      const channel = ctx.newState;
      const metadata = channel.metadata;

      if ((metadata?.org ?? "") === "") {
        throw invalidArgumentError(ORG_REQUIRED_MESSAGE);
      }

      const agentRef = channel.spec?.agentRef;
      if ((agentRef?.slug ?? "") === "") {
        throw invalidArgumentError(AGENT_REF_SLUG_REQUIRED_MESSAGE);
      }

      const refOrg = agentRef!.org !== "" ? agentRef!.org : metadata!.org;

      if (refOrg !== metadata!.org) {
        throw failedPreconditionError(sameOrgInvariantMessage(refOrg));
      }

      validateChannelModelPin(registry, channel.spec);

      const appRef = channel.spec?.appRef;
      const isWhatsApp = channel.spec?.providerConfig.case === "whatsapp";
      if (isWhatsApp && (appRef?.slug ?? "") === "") {
        throw invalidArgumentError(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
      }

      // The BYO app must be the channel's own org's; normalized and
      // checked before the agent load for the same no-probing reason.
      // Deliberately NO existence or provider-match check: like
      // environment_refs, enforcement lives at resolution time (the cloud
      // install flow fails closed; OSS has no install flow).
      if ((appRef?.slug ?? "") !== "") {
        const appRefOrg = appRef!.org !== "" ? appRef!.org : metadata!.org;
        if (appRefOrg !== metadata!.org) {
          throw failedPreconditionError(APP_REF_SAME_ORG_MESSAGE);
        }
        appRef!.org = appRefOrg;
      }

      let agent;
      try {
        agent = await findResourceBySlug(
          store,
          ApiResourceKind.agent,
          AgentSchema,
          agentRef!.slug,
          refOrg,
        );
      } catch (error) {
        throw internalError(error, "failed to list agent resources");
      }
      if (agent === undefined) {
        // Byte-identical with the direct agent lookup's refusal (T09).
        throw notFoundError("Agent", agentRef!.slug);
      }

      agentRef!.org = refOrg;
    },
  };
}

/**
 * InitInstallState — Go initInstallStateStep: writes
 * status.install_state = pending_install; the channel exists but serves
 * no traffic until the provider install completes — which in this edition
 * never happens (the §0-b refusal is the only install surface).
 *
 * Runs AFTER BuildNewState, which clears client-provided status — the
 * install state is system-managed and must survive that wipe, exactly
 * like the audit fields (the agentshare StampAgentPin positioning).
 */
export function newInitInstallStateStep(): PipelineStep<AgentChannelDesc> {
  return {
    name: "InitInstallState",
    execute(ctx: RequestContext<AgentChannelDesc>): void {
      const channel = ctx.newState;
      const status = channel.status ?? create(AgentChannelStatusSchema);
      status.installState = AgentChannelInstallState.pending_install;
      channel.status = status;
    },
  };
}

/**
 * The manifest vocabulary for the channel's provider arm — Go
 * providerFieldName resolves the populated oneof member's PROTO field
 * name through reflection (what users declared in YAML), and that name is
 * interpolated into byte-pinned error copy. protobuf-es surfaces the
 * arm's camelCased localName as the oneof `case`, which coincides with
 * the proto name for `slack`/`whatsapp` but would diverge for a future
 * snake_case arm (e.g. `ms_teams` → case "msTeams") — so the proto name
 * is resolved through the schema descriptor, not read off the case.
 * Exported for the unit pin (Go TestProviderFieldName).
 */
export function providerFieldName(spec: AgentChannelSpec | undefined): string {
  const arm = spec?.providerConfig.case;
  if (arm === undefined) {
    return "";
  }
  const oneof = AgentChannelSpecSchema.oneofs.find(
    (o) => o.name === "provider_config",
  );
  return oneof?.fields.find((f) => f.localName === arm)?.name ?? arm;
}

/**
 * ValidateChannelUpdate — Go validateChannelUpdateStep: spec.agent_ref
 * must keep referencing the same agent; the provider arm must not change
 * (install state, credentials, and delivery records are all
 * provider-shaped); the model pin is re-validated; then the app_ref rules
 * (validateAppRefUpdate). Runs after LoadExisting. metadata.slug/org and
 * status (install facts, credentials reference) need no step — the
 * generic BuildUpdateState preserves them wholesale.
 */
export function newValidateChannelUpdateStep(
  registry: ModelRegistryStore,
): PipelineStep<AgentChannelDesc> {
  return {
    name: "ValidateChannelUpdate",
    execute(ctx: RequestContext<AgentChannelDesc>): void {
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as AgentChannel | undefined;
      if (existing === undefined) {
        throw internalError(
          new Error("existing agent channel not found in context"),
          "existing agent channel not found in context",
        );
      }

      const inputRef = ctx.input.spec?.agentRef;
      const existingRef = existing.spec?.agentRef;

      // Normalize the input ref's org the same way create does (empty
      // means the channel's own org) before comparing.
      const inputOrg =
        (inputRef?.org ?? "") !== "" ? inputRef!.org : (existing.metadata?.org ?? "");

      if (
        (inputRef?.slug ?? "") !== (existingRef?.slug ?? "") ||
        inputOrg !== (existingRef?.org ?? "")
      ) {
        throw failedPreconditionError(
          agentRefImmutableMessage(existingRef?.org ?? "", existingRef?.slug ?? ""),
        );
      }

      const inputProvider = providerFieldName(ctx.input.spec);
      const existingProvider = providerFieldName(existing.spec);
      if (inputProvider !== existingProvider) {
        throw failedPreconditionError(providerImmutableMessage(existingProvider));
      }

      validateChannelModelPin(registry, ctx.input.spec);

      validateAppRefUpdate(ctx, existing);
    },
  };
}

/**
 * The app_ref rules on update (T04 item 2) — Go validateAppRefUpdate,
 * byte-identical with the cloud edition's ValidateChannelUpdate:
 *   - required for whatsapp (repeated here because update does not run
 *     the defaults resolver; provider immutability above guarantees the
 *     existing channel is also whatsapp);
 *   - same-org always;
 *   - frozen while installed — pending and revoked channels rebind
 *     freely (on OSS only the rebind-while-pending half is reachable:
 *     install_state never reaches `installed` here).
 */
function validateAppRefUpdate(
  ctx: RequestContext<AgentChannelDesc>,
  existing: AgentChannel,
): void {
  const inputAppRef = ctx.input.spec?.appRef;
  const existingAppRef = existing.spec?.appRef;

  const isWhatsApp = ctx.input.spec?.providerConfig.case === "whatsapp";
  if (isWhatsApp && (inputAppRef?.slug ?? "") === "") {
    throw invalidArgumentError(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
  }

  let inputAppOrg = "";
  if ((inputAppRef?.slug ?? "") !== "") {
    inputAppOrg =
      inputAppRef!.org !== "" ? inputAppRef!.org : (existing.metadata?.org ?? "");
  }

  if (inputAppOrg !== "" && inputAppOrg !== (existing.metadata?.org ?? "")) {
    throw failedPreconditionError(APP_REF_SAME_ORG_MESSAGE);
  }

  const installed =
    existing.status?.installState === AgentChannelInstallState.installed;
  const changed =
    (inputAppRef?.slug ?? "") !== (existingAppRef?.slug ?? "") ||
    ((inputAppRef?.slug ?? "") !== "" && inputAppOrg !== (existingAppRef?.org ?? ""));

  if (installed && changed) {
    throw failedPreconditionError(APP_REF_FROZEN_WHILE_INSTALLED_MESSAGE);
  }
}
