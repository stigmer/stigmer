/**
 * The organization purge point: what a unit removes when an organization
 * is deleted, and what it keeps on purpose.
 *
 * Deleting an organization marks it and answers; the purge then removes
 * everything the organization owned, in the background, in stages
 * (domain/organization/purge/runner.ts):
 *
 *   quiesce  → stop what is running (schedules, executions, sandboxes)
 *   edition  → every unit's stages, in unit order, then each unit's stages
 *              in the order it lists them
 *   content  → every kind the core keeps, leaves first
 *   shred    → every secret codec's per-organization keys destroyed
 *   children → wait until no child organization names it
 *   final    → quiesce, the units' stages and content again; its
 *              policies, its search entry, its row, its names, and last
 *              its deletion mark
 *
 * A unit's stages run after quiesce and before content, while the
 * organization's core rows still exist, so a stage can find its own rows
 * through them (a session's checkpoints, an execution's files). One phase
 * for every unit stage, so the contract carries no ordering knob.
 *
 * A stage's contract:
 *   - `run` removes a bounded batch and answers whether more is left
 *     (`more`), so a large organization purges over many calls; the runner
 *     calls it again until it answers `more: false`, recording progress
 *     between calls.
 *   - `run` is idempotent: a pod that dies mid-stage leaves the purge to
 *     another, which calls the stage again from the start, and two pods
 *     overlapping repeat work, never answer wrong. The final stage also
 *     calls every stage again, to its end, before anything final, for a
 *     row written after the stage first passed.
 *   - `run` works through the unit's own stores and the composed services,
 *     never the RPC surface: every RPC naming the organization answers
 *     not-found from the moment it is marked (domain/organization/
 *     lifecycle.ts).
 *   - A throw records the stage's fault and the runner retries the purge
 *     later, with backoff; the organization keeps answering not-found.
 *     Log the cause in the stage; the runner records only fixed copy.
 *
 * `kinds` declares the resource kinds a stage removes, and `retains` the
 * rows a unit keeps on purpose, each with its reason (money, an audit
 * trail). Boot refuses a composition in which a served kind that belongs
 * to an organization is owned by none, or by more than one, of: a core
 * purge, a unit stage's `kinds`, a retention (boot/organization-purge.ts),
 * the precedent being the refusal of a served kind no reader can read.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import type { CallerIdentity } from "./identity.js";

/** The organization a purge removes. */
export interface OrganizationPurgeTarget {
  readonly id: string;
  /** Its parent's id; "" for an organization that is not a child. */
  readonly parentOrg: string;
}

/** What a stage receives on every call. */
export interface OrganizationPurgeContext {
  readonly org: OrganizationPurgeTarget;
  readonly logger: Logger;
  /**
   * The identity the purge acts as: the server acting for the
   * organization's deletion (an internal caller), for the stores and ports
   * that record who removed a row.
   */
  readonly caller: CallerIdentity;
}

/** A stage's answer: whether it has more to remove. */
export interface OrganizationPurgeProgress {
  readonly more: boolean;
  /**
   * Set with `more`: nothing can be removed now (the children stage waits
   * for its children's purges), so the runner leaves the purge until a
   * later pass instead of calling again at once.
   */
  readonly wait?: boolean;
}

export interface OrganizationPurgeStage {
  /** Unique across the composition; names the stage in the deletion record and the logs. */
  readonly name: string;
  /** The resource kinds this stage removes (the boot inventory's ownership). */
  readonly kinds?: ReadonlyArray<ApiResourceKind>;
  run(context: OrganizationPurgeContext): Promise<OrganizationPurgeProgress>;
}

/** Rows a purge keeps on purpose. Exactly one of `table` and `kind`. */
export interface RetainedRows {
  /** A table the unit keeps, schema-qualified where it has a schema ("cloud.credit_ledger_entry"). */
  readonly table?: string;
  /** A resource kind the unit keeps. */
  readonly kind?: ApiResourceKind;
  /** Why the rows outlive the organization, in a sentence. */
  readonly reason: string;
}

/** A unit's contribution: its stages, in the order they run, and what it keeps. */
export interface OrganizationPurgeContribution {
  readonly stages?: ReadonlyArray<OrganizationPurgeStage>;
  readonly retains?: ReadonlyArray<RetainedRows>;
}

/** A stage or retention with the unit that contributed it. */
export interface ResolvedOrganizationPurge {
  readonly stages: ReadonlyArray<{
    readonly unit: string;
    readonly stage: OrganizationPurgeStage;
  }>;
  readonly retains: ReadonlyArray<{
    readonly unit: string;
    readonly retained: RetainedRows;
  }>;
}
