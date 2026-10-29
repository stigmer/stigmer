/**
 * Memory domain constants — the byte-pinned cross-edition contract copy.
 * Every string here is pinned by the conformance suite and served by every
 * edition; none is editable without a deliberate wire change. Refusals are visible and actionable — never silent eviction
 * (the ChatGPT Memory-Full pattern).
 */

/**
 * The per-subject-per-org record ceiling, counted across ALL lifecycle
 * states — proposed clutter counts, which pressures honest rejection over
 * letting proposals pile up.
 */
export const MAX_MEMORIES_PER_SUBJECT = 100;

/**
 * Refuses a create once the subject's ceiling is reached.
 */
export const MEMORY_FULL_MESSAGE =
  "memory is full — review and delete existing memories";

/**
 * Refuses a create while the organization has not enabled memory, taking
 * the org slug.
 */
export function memoryDisabledMessage(org: string): string {
  return `memory is not enabled for organization ${org} — an organization admin can enable it in organization preferences`;
}

/**
 * Refuses a create while the PERSON the memory would be about has not
 * enabled memory on their own account — the member half of the double
 * opt-in, and the answer for a caller no account stands for,
 * since only an unprovisioned person reaches that arm. Byte-pinned: the
 * clients render it as it is.
 */
export const MEMORY_ACCOUNT_DISABLED_MESSAGE =
  "memory is not enabled for your account — enable it in account preferences";

/**
 * Refuses confirming a rejected memory: the decision is auditable and
 * stands; a fresh proposal is the way back.
 */
export const MEMORY_CONFIRM_REJECTED_MESSAGE =
  "memory was rejected — delete it and let the agent propose it again";

/**
 * Refuses rejecting a confirmed memory: deletion IS the revocation of a
 * confirmed fact.
 */
export const MEMORY_REJECT_CONFIRMED_MESSAGE =
  "memory was confirmed — delete it to stop it from being recalled";

/**
 * Refuses an update that changes the subject: an editable subject would
 * re-aim the record at another person.
 */
export const MEMORY_SUBJECT_IMMUTABLE_MESSAGE =
  "spec.subject_identity_account_id is immutable — it is derived from the capturing credential at create";

/**
 * Refuses an update that changes provenance: attribution that can be
 * edited is not attribution.
 */
export const MEMORY_PROVENANCE_IMMUTABLE_MESSAGE =
  "spec.provenance is immutable — it records where the fact came from";
