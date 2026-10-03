/**
 * Named gate slots — the pipeline injection mechanism. A slot is a point in
 * a shared per-RPC chain where the builder splices extension-registered
 * gate steps: zero steps in OSS, the cloud's gates in the cloud
 * composition. Slot names are PROTECTED VOCABULARY (never renamed,
 * byte-stable), scoped `<chain-name>:<position>`.
 *
 * The first five slots sit at their Java-verified semantic positions.
 * `sandbox-acquisition:gate` was declared only once its splice sites
 * existed (a declared slot whose steps can never run would be a silent
 * no-op, the exact failure the boot-time slot check exists to prevent):
 * the workflow-execution chains have no
 * generic pre-side-effect slot, and their Java-verified capacity-gate
 * position (post-authorize, before any side effect, pre-provision)
 * is where the cloud's sandbox-capacity gate rides on
 * BOTH the create and recover chains. The session lane needs no sixth
 * splice — its capacity gates ride the two declared agent-execution
 * slots, whose positions coincide exactly with the Java session gate.
 *
 * The seventh is
 * `identity-account-provision:post-persist`: inside provisionMyAccount,
 * after the provisioner has answered the caller's row — created on this
 * call or found by the idempotent early return — and before the reply,
 * with the caller RE-STAMPED as the account (the position-1 identity was
 * idp-shaped because no row existed when the verifier ran). It fires on
 * EVERY provisionMyAccount, not only the creating one: the cloud's
 * personal-organization step backfills accounts that predate personal
 * organizations on the idempotent path, which is exactly why a slot was
 * chosen over the tuple lifecycle's onResourceCreated (never fired for a
 * row that already exists). Never on the create RPC and never at the
 * boot-time operator ensure, which take the create path, not this one.
 * Non-transactional in the `org-create:post-persist` sense: a gate
 * failure fails the request, the row survives, the next call heals.
 *
 * The eighth, `iam-policy-create:pre-side-effect-gate`: the IamPolicy
 * `create` chain (the user grant lane), after ValidateGrantableRole and
 * before Grant, so nothing is written when a gate refuses. It exists for
 * the checks a grant needs that take a read, which the synchronous grant
 * scope may not make: the Enterprise and Cloud editions refuse a team
 * that does not exist, a team of another organization than the granted
 * resource, and a team member who is not one of the organization's
 * viewers. Never on `bootstrapPolicy`, the platform's structural lane.
 *
 * The ninth, `org-create:pre-side-effect-gate`: the organization create
 * chain after its last pure step (CopySlugToId) and before Persist, the
 * position the session chain's slot holds. It exists for a refusal that
 * must leave nothing behind: `org-create:post-persist` runs after the row
 * is written, so a limit enforced there would leave the organization it
 * refused. The Cloud refuses a platform-managed organization its
 * integrator's plan does not admit; a licensed deployment's organization
 * limit belongs here too. `apply` delegates to create on its create arm,
 * so the slot fires there as well.
 *
 * The tenth, `org-delete:pre-delete`: the organization delete chain after
 * LoadExistingForDelete and before any write, so the organization exists
 * and is loaded (EXISTING_RESOURCE_KEY) while its steps run. Whatever an
 * edition keeps for the organization must go before the row does, or be
 * refused: a row left behind is trust or state that nobody administers.
 * (The slug itself is never taken again, domain/organization/slug-ledger.ts,
 * so nothing left behind can pass to a new holder of the slug; the order
 * still keeps an edition's rows from outliving their organization.) Its
 * steps may refuse (Enterprise refuses while an
 * identity provider still signs in platform-managed organizations) or
 * remove the edition's own rows; either way a throw fails the delete with
 * the organization intact, and the retry re-runs every step, so each owns
 * its idempotency. After the slot the chain revokes the organization's own
 * policy rows, also before the row and also failing closed.
 *
 * Two enforcement layers, deliberately redundant, both derived from the
 * ONE literal tuple below (lockstep by construction):
 *   - GateSlotName (compile time): the union of declared slot literals.
 *     A TS consumer cannot express a registration into an unknown slot.
 *   - DECLARED_GATE_SLOTS (boot time): the load-bearing contract. A JS
 *     consumer, or a composition built against a pin where a slot has
 *     since moved, must throw loudly at boot — never no-op silently.
 *
 * Slot semantics for gate authors (recorded facts, not mechanisms —
 * details in the ts-server guidelines' slot table):
 *   - Slots run wherever their chain runs, INCLUDING in-process
 *     invocations (the Java baseline: internal creations traverse the
 *     full nested handler chains). In-process callers carry
 *     `callerClass: "internal"` (the in-process identity semantics), where
 *     the Java edition propagated the original caller — gates keying on
 *     caller class must account for the `internal` arm.
 *   - Slots do not honor chain-internal skip shortcuts (e.g. the
 *     lifecycle already-in-target idempotent flag): a gate runs on every
 *     traversal of its position and owns its own idempotency.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { PipelineStep } from "../pipeline/pipeline.js";

/**
 * The declared slot names. Grows only with
 * owner-visible slot additions — each entry cites its chain position in
 * the guidelines' slot table, which must match the splice sites exactly.
 */
export const GATE_SLOT_NAMES = [
  "agent-execution-create:pre-side-effect-gate",
  "agent-execution-recover:pre-side-effect-gate",
  "agent-execution-submit-approval:gate",
  "session-create:pre-side-effect-gate",
  "org-create:post-persist",
  "sandbox-acquisition:gate",
  "identity-account-provision:post-persist",
  "iam-policy-create:pre-side-effect-gate",
  "org-create:pre-side-effect-gate",
  "org-delete:pre-delete",
] as const;

/** The declared slot-name union — a registration outside it fails tsc. */
export type GateSlotName = (typeof GATE_SLOT_NAMES)[number];

/**
 * The boot-time declared-slot set — resolveExtensions validates every
 * registration against it (the unknown-slot throw).
 */
export const DECLARED_GATE_SLOTS: ReadonlySet<string> = new Set<string>(
  GATE_SLOT_NAMES,
);

/**
 * The merged slot registrations the chains consume — slot name → steps in
 * unit order (registry.ts builds it; keys are validated slot names).
 */
export type ResolvedGateSteps = ReadonlyMap<
  string,
  ReadonlyArray<PipelineStep<DescMessage>>
>;

/**
 * The steps registered into one slot, typed for the consuming chain — the
 * ONE place the empty-slot default lives, so splice sites never scatter
 * `?? []` and a slot-name typo is a compile error.
 */
export function stepsForSlot<Desc extends DescMessage>(
  gateSteps: ResolvedGateSteps,
  slot: GateSlotName,
): ReadonlyArray<PipelineStep<Desc>> {
  const steps = gateSteps.get(slot) ?? [];
  // Sound narrowing: a gate step is written against
  // RequestContext<DescMessage> and consumes only the context surface
  // every specialization shares. Centralized here so no chain carries a
  // local cast.
  return steps as ReadonlyArray<PipelineStep<Desc>>;
}
