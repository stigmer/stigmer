/**
 * The drivers extension point — infrastructure substitution seams of the
 * convergence blueprint (20260826.02 blueprint/03 §6, DD-006 §2a). The
 * point exists from O1 (20260826.09) so the registry carries all seven
 * ratified point types; the registrable KINDS join with their extraction
 * entries, each adding a field here as an owner-visible surface change:
 *
 *   - model-catalog provider (§6a) and artifact-storage driver
 *     registration + runner-credential provider (§6b/§6c) — O5
 *   - sandbox provisioners (§6d) — O6
 *
 * Empty deliberately, not provisionally: those interfaces are extractions
 * from verified read surfaces, and guessing their shapes here would hand
 * O5/O6 churn instead of a seam (the ruled ratified-types scope decision,
 * this sub-project's T01 record).
 */

/** The driver contributions of one extension unit. No kinds exist yet. */
export interface ExtensionDrivers {}
