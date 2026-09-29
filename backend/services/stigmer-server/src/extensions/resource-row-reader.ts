/**
 * The resource-row-reader driver point: where the built-in authorizer
 * reads the rows of a kind a unit keeps in a store of its own. Keyed by
 * kind, registered as `drivers.resourceRowReaders`.
 *
 * The built-in authorizer evaluates the one authorization model over the
 * tuples each row stands for, derived from the row when a check asks
 * (authorization/derived-tuples.ts). It reads open source's kinds from the
 * generic Store and identity accounts through the account port. A kind an
 * edition above open source serves (an identity provider, an invitation,
 * a team) lives wherever the unit that serves it keeps it, so the unit
 * says where: it registers a reader for each such kind, and the built-in
 * loader asks that reader before the generic Store. A unit that keeps its
 * rows in the generic Store registers a reader over it; one with tables of
 * its own registers a reader over those. Under a composition's own
 * Authorizer nothing reads them.
 *
 * The contract:
 *   - `findById` answers the row decoded with the kind's model schema
 *     (authorization/model/bindings.ts), or undefined when no row has the
 *     id. Undefined is a real answer: the authorizer then denies, and never
 *     reports the row missing, for the kinds whose existence it does not
 *     disclose (authorization/authorizer.ts, NOT_FOUND_EXEMPT_KINDS).
 *   - A fault it cannot answer through THROWS (the ListReadScope rule: an
 *     absent row is never an outage in disguise), and the check answers
 *     unavailable, never a denial.
 *   - The row's organization, creator stamp and visibility are the ones
 *     its unit wrote: the tuples derive from them, so a reader that hands
 *     back a different organization grants that organization's members.
 *
 * The merge rules (extensions/registry.ts): one reader per kind across the
 * composed set; never for an open-source kind, whose rows are open
 * source's own store's; never for `identity_account`, whose rows are read
 * through the account port a composition substitutes as
 * `drivers.identityAccountStore`. Each is a boot throw naming the unit.
 */
import type { Message } from "@bufbuild/protobuf";

/** The row-reader contract (keyed point, ExtensionDrivers.resourceRowReaders). */
export interface ResourceRowReader {
  /** The row with this id, decoded with the kind's model schema, or undefined when absent. */
  findById(id: string): Promise<Message | undefined>;
}
