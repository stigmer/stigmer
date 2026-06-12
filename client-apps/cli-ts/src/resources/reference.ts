// Parse a user-supplied resource reference into either an ID lookup or an
// org/slug lookup, mirroring the Go CLI's parseOrgSlug + ID detection.
//
//   "agt_abc123"        -> by ID
//   "my-org/my-agent"   -> by org/slug (explicit org)
//   "my-agent"          -> by org/slug (org from --org/context)
//
// The kind's id_prefix disambiguates a bare token: "org" resolves "org_x" as an
// ID but "acme" as a slug.

export type ParsedReference =
  | { readonly kind: "id"; readonly id: string }
  | { readonly kind: "ref"; readonly org: string; readonly slug: string };

export function parseReference(ref: string, defaultOrg: string, idPrefix: string): ParsedReference {
  const trimmed = ref.trim();

  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    return { kind: "ref", org: trimmed.slice(0, slash), slug: trimmed.slice(slash + 1) };
  }

  if (idPrefix !== "" && trimmed.startsWith(`${idPrefix}_`)) {
    return { kind: "id", id: trimmed };
  }

  return { kind: "ref", org: defaultOrg, slug: trimmed };
}
