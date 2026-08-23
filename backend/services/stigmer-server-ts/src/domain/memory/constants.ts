/**
 * Memory domain constants — the byte-pinned cross-edition contract copy,
 * ported character-for-character from Go
 * pkg/domain/memory/controller/steps.go. Every string here is pinned by
 * the conformance suite and mirrored byte-identically by the cloud
 * edition's handlers; none is editable without an owner-ratified wire
 * change. Refusals are visible and actionable — never silent eviction
 * (the ChatGPT Memory-Full pattern, DD-006 D5).
 */

/**
 * The per-subject-per-org record ceiling, counted across ALL lifecycle
 * states — proposed clutter counts, which pressures honest rejection over
 * letting proposals pile up (DD-006 D5). Go MaxMemoriesPerSubject.
 */
export const MAX_MEMORIES_PER_SUBJECT = 100;

/**
 * Refuses a create once the subject's ceiling is reached — Go
 * MemoryFullMessage.
 */
export const MEMORY_FULL_MESSAGE =
  "memory is full — review and delete existing memories";

/**
 * Refuses a create while the organization has not enabled memory — Go
 * MemoryDisabledMessageFmt, taking the org slug.
 */
export function memoryDisabledMessage(org: string): string {
  return `memory is not enabled for organization ${org} — an organization admin can enable it in organization preferences`;
}

/**
 * Refuses confirming a rejected memory: the decision is auditable and
 * stands; a fresh proposal is the way back. Go
 * MemoryConfirmRejectedMessage.
 */
export const MEMORY_CONFIRM_REJECTED_MESSAGE =
  "memory was rejected — delete it and let the agent propose it again";

/**
 * Refuses rejecting a confirmed memory: deletion IS the revocation of a
 * confirmed fact (DD-006). Go MemoryRejectConfirmedMessage.
 */
export const MEMORY_REJECT_CONFIRMED_MESSAGE =
  "memory was confirmed — delete it to stop it from being recalled";

/**
 * Refuses an update that changes the subject: an editable subject would
 * re-aim the record at another person. Go MemorySubjectImmutableMessage.
 */
export const MEMORY_SUBJECT_IMMUTABLE_MESSAGE =
  "spec.subject_identity_account_id is immutable — it is derived from the capturing credential at create";

/**
 * Refuses an update that changes provenance: attribution that can be
 * edited is not attribution. Go MemoryProvenanceImmutableMessage.
 */
export const MEMORY_PROVENANCE_IMMUTABLE_MESSAGE =
  "spec.provenance is immutable — it records where the fact came from";
