/**
 * The principal-display driver point: how an access list names a grantee
 * that is not a person. Single instance, registered as
 * `drivers.principalDisplay`.
 *
 * An access list ("who has access to this agent, with which roles") names
 * every grantee. People are resolved by the core from the identity-account
 * port (domain/iampolicy/display-resolver.ts), the same in every edition.
 * A grantee of another kind — a team, in the Enterprise and Cloud editions
 * — lives in a store only that edition holds, so its name comes from this
 * point. Absent (open source, which grants to no team), such a grantee
 * renders in the fallback shape the access list has always used: its kind,
 * with its id standing in as its name.
 *
 * The contract:
 *   - It answers for the ids it knows and omits the rest; an omitted id
 *     takes the fallback shape, never an error (a team deleted between
 *     the grant read and this call is an omission, not a fault).
 *   - It is never asked about the identity account; the core owns people.
 *   - A fault it cannot answer through THROWS (the ListReadScope rule:
 *     an empty answer is a real answer, never an outage in disguise), and
 *     the list RPC fails with it.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

/** The principal-display contract (single-instance point, ExtensionDrivers.principalDisplay). */
export interface PrincipalDisplay {
  /**
   * Display views for the principals of `kind` with these ids, keyed by
   * id; ids it does not know are absent from the map.
   */
  resolve(
    kind: ApiResourceKind,
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ApiResourceRefView>>;
}
