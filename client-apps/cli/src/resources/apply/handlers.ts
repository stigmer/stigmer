// Apply-handler registry for `apply -f` (file mode) and the synthesis track.
//
// The declarative manifest kinds come from the SDK's manifest registry
// (`manifestKinds()` in @stigmer/sdk) — the one table binding a kind to its
// proto schema, its raw command-controller `apply` RPC, and its dependency
// apply order. The CLI consumes that table instead of keeping a copy: the
// copy this file used to carry drifted twice (ChannelApp was missing
// entirely — stigmer/stigmer#353 — and three kinds were absent from the
// local ordering map, so multi-document bundles applied on file-order luck).
//
// Both registries drive the *generated controllers* directly — not the
// high-level SDK `apply(input)` methods — because the SDK's `*Input`
// wrappers are lossy (they drop `metadata.id`, so an update would be
// misrouted as a create). The `apply` RPC takes the full resource message,
// preserving every field round-tripped from YAML.
//
// CLI_EXTRA_HANDLERS carries the kinds the CLI applies but the SDK's
// manifest engine deliberately does not treat as manifest kinds:
// Organization (not org-scoped — the bootstrap resource every other kind
// lives inside) and the runtime-instance kinds (WorkflowInstance, Session).
// A kind added here must also declare Apply in the registry's verb matrix —
// the conformance test in registry/registry.test.ts enforces both
// directions, so an entry without a matrix line (or vice versa) fails CI.

import type { DescMessage, DescService, Message } from "@bufbuild/protobuf";
import type { Client } from "@connectrpc/connect";
import type { UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { type Session, SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import {
  type WorkflowInstance,
  WorkflowInstanceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { WorkflowInstanceCommandController } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { type Organization, OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { manifestKinds } from "@stigmer/sdk";

/** Accessor for a raw Connect client over a generated service controller. */
export type ControllerFn = <Desc extends DescService>(service: Desc) => Client<Desc>;

export interface ApplyHandler {
  readonly kind: ApiResourceKind;
  /** Human-facing name for messages, e.g. "MCP Server". */
  readonly displayName: string;
  /** Proto schema for strict YAML→proto marshalling. */
  readonly schema: DescMessage;
  /**
   * Position in the dependency apply order (ascending) — referenced kinds
   * apply before their dependents. Manifest kinds carry the SDK registry's
   * value; the CLI extras slot around them (organization first, the
   * runtime-instance kinds after every blueprint they can reference).
   */
  readonly applyOrder: number;
  /** Drive the controller's `apply` RPC with the full resource message. */
  apply(controller: ControllerFn, message: Message): Promise<Message>;
  /**
   * Drive the controller's `updateVisibility` RPC — the only door for
   * visibility changes (plain updates preserve stored visibility, oss#573).
   * Present exactly when the kind has the RPC; the apply core follows up
   * through it when a manifest-declared level differs from the stored one.
   * Manifest kinds inherit the binding from the SDK registry.
   */
  updateVisibility?(controller: ControllerFn, input: UpdateVisibilityInput): Promise<Message>;
}

// The SDK registry's applyOrder values end at schedule = 12; the extras slot
// outside that range so a future SDK kind never collides with them.
const CLI_EXTRA_HANDLERS: readonly ApplyHandler[] = [
  {
    kind: ApiResourceKind.organization,
    displayName: "Organization",
    schema: OrganizationSchema,
    applyOrder: 0,
    apply: (c, m) => c(OrganizationCommandController).apply(m as Organization),
  },
  {
    kind: ApiResourceKind.workflow_instance,
    displayName: "Workflow Instance",
    schema: WorkflowInstanceSchema,
    applyOrder: 13,
    apply: (c, m) => c(WorkflowInstanceCommandController).apply(m as WorkflowInstance),
    updateVisibility: (c, i) => c(WorkflowInstanceCommandController).updateVisibility(i),
  },
  {
    kind: ApiResourceKind.session,
    displayName: "Session",
    schema: SessionSchema,
    applyOrder: 14,
    apply: (c, m) => c(SessionCommandController).apply(m as Session),
  },
];

export const APPLY_HANDLERS: ReadonlyMap<ApiResourceKind, ApplyHandler> = new Map<ApiResourceKind, ApplyHandler>([
  ...manifestKinds().map((handler) => [handler.kind, handler] as const),
  ...CLI_EXTRA_HANDLERS.map((handler) => [handler.kind, handler] as const),
]);
