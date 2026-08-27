/**
 * The model-catalog provider seam — DD-008 (convergence program
 * 20260826.02, blueprint/03 §6a), extracted with O5 (20260827.02).
 *
 * ONE interface covers catalog data AND pin-policy source: the registry
 * document, model/harness validity, pricing-variant and capability
 * queries, canonical-model listing. A split seam was rejected by the
 * ratified DD-008 ruling — separating the priced catalog from the pin
 * policy lets them drift apart, recreating exactly the selectable-vs-billed
 * drift the one-store design exists to prevent.
 *
 * Two disciplines are CONTRACT here, not folklore:
 *
 *   1. Reads are PER CALL. Implementations may cache internally (they own
 *      invalidation), but consumers never build boot-time indexes over
 *      this provider. The named counterexample is the cloud Java
 *      ModelValidationHelper's @PostConstruct index, which captured the
 *      stage-1 embedded registry before the DB baseline loaded and served
 *      stale validity for the process's whole life.
 *   2. Validation logic stays OSS and edition-neutral. The did-you-mean
 *      pin machinery (pin-validation.ts) and every refusal message CONSUME
 *      this provider; an edition substitutes the data source only, never
 *      the judgment. Refusal copy is conformance-visible shared contract.
 *
 * The OSS implementation is ModelRegistryStore (bundled snapshot + hourly
 * upstream refresh), unchanged; its refresh lifecycle is deliberately NOT
 * part of this contract — refresh is how ONE implementation keeps itself
 * current, owned by the composition root that constructs it. Extensions
 * substitute an implementation through the drivers registry point
 * (extensions/drivers.ts); with none composed, behavior is byte-identical
 * to the pre-extraction store.
 */

/**
 * Read surface of the model catalog. All answers reflect the
 * implementation's CURRENT document — callers re-ask per request and never
 * memoize across requests (discipline 1 above).
 */
export interface ModelCatalogProvider {
  /** The served registry document bytes; always complete and valid. */
  document(): string;

  /**
   * Whether a model reference (canonical id or provider api id) is
   * executable on the given harness.
   */
  isValidModel(harness: string, model: string): boolean;

  /** Whether the catalog knows any models for a harness. */
  hasHarness(harness: string): boolean;

  /**
   * Whether the catalog loaded at all — validation degrades to a no-op
   * rather than rejecting everything when it did not.
   */
  hasAnyModels(): boolean;

  /**
   * Whether a model reference is executable on AT LEAST ONE harness. The
   * existence check for surfaces with no serving harness in this edition
   * (agent channels): a pin no section knows is certainly a typo, while a
   * pin valid anywhere may be right where the spec actually serves.
   */
  isValidModelOnAnyHarness(model: string): boolean;

  /**
   * The sorted, deduplicated canonical model ids across every harness
   * section — the did-you-mean candidate pool for the any-harness
   * existence check. Callers must not mutate the result.
   */
  canonicalModelsAcrossHarnesses(): string[];

  /**
   * The sorted canonical model ids for a harness (deterministic
   * did-you-mean suggestions — canonical ids are the documented form, so
   * suggestions never surface provider api ids). Callers must not mutate.
   */
  canonicalModels(harness: string): string[];

  /**
   * Whether a model reference prices the given variant key under ANY
   * harness — the capability check for ExecutionConfig.service_tier at
   * execution create (oss#357), deliberately harness-free (it never
   * resolves the session).
   */
  hasPricingVariant(model: string, variant: string): boolean;

  /**
   * Whether a model reference prices the given variant key under the given
   * harness. The workflow validators use this form — the task config names
   * its harness, so a fast variant priced only under another harness must
   * not validate (it would execute as a silent no-op).
   */
  hasPricingVariantForHarness(
    harness: string,
    model: string,
    variant: string,
  ): boolean;

  /**
   * The sorted canonical model ids that price the given variant key under
   * any harness, for actionable refusal messages. Callers must not mutate.
   */
  canonicalModelsWithVariant(variant: string): string[];

  /**
   * The sorted canonical model ids that price the given variant key under
   * the given harness. Callers must not mutate.
   */
  canonicalModelsWithVariantForHarness(
    harness: string,
    variant: string,
  ): string[];

  /**
   * Whether a model reference declares the given capability key (e.g.
   * "thinking") true under the given harness. Capability flags are
   * harness-scoped facts, so there is no any-harness form (oss#772).
   */
  hasCapabilityForHarness(
    harness: string,
    model: string,
    capability: string,
  ): boolean;

  /**
   * The sorted canonical model ids that declare the given capability key
   * under the given harness, for actionable refusal messages.
   */
  canonicalModelsWithCapabilityForHarness(
    harness: string,
    capability: string,
  ): string[];
}
