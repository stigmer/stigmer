/**
 * The three facts a test of the server-minted id needs, read from the proto
 * and never spelled: a kind's `kind_meta`, the shape the shared create step
 * mints, and a well-formed foreign id of that shape for a caller to send.
 *
 * The contract (stigmer/stigmer#1489): a create, or an apply that creates,
 * replaces any `metadata.id` the caller sent with `{kind id_prefix}_` plus a
 * lowercase ULID. A foreign id is built the same way, so a case proves the
 * server refuses a plausible id, not only a malformed one. The OSS
 * conformance suite holds the rule for the open-source kinds, in
 * stigmer/stigmer's `test/conformance/src/suites/create-mints-id.conformance.test.ts`;
 * the kinds only Enterprise serves are held here, beside the units that
 * serve them.
 *
 * Edition-neutral by what it imports (the proto runtime, the stubs and the
 * ULID generator), so the Enterprise identity unit's published suite and a
 * host's own suites share it.
 */
import { getOption, hasOption } from "@bufbuild/protobuf";
import {
  type ApiResourceKind,
  ApiResourceKindSchema,
  type ApiResourceKindMeta,
  kind_meta,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ulid } from "ulidx";

/** A kind's `kind_meta` option, or a failure naming the kind that carries none. */
export function kindMetaOf(kind: ApiResourceKind): ApiResourceKindMeta {
  const value = ApiResourceKindSchema.values.find((candidate) => candidate.number === kind);
  if (value === undefined || !hasOption(value, kind_meta)) {
    throw new Error(`ApiResourceKind ${kind} carries no kind_meta option`);
  }
  return getOption(value, kind_meta);
}

/**
 * The id the shared create step mints for `prefix`: the prefix, then a ULID
 * lowercased, 26 characters of Crockford base-32 (no i, l, o or u).
 */
export function mintedIdPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}_[0-9a-hjkmnp-tv-z]{26}$`);
}

/** A well-formed id of the kind's own shape that the server did not mint: what a caller would choose. */
export function foreignId(prefix: string): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
