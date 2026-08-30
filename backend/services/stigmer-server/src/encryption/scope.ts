/**
 * The scope under which a secret is encrypted — ports the cloud edition's
 * ai.stigmer.infra.encryption.EncryptionScope record: its tenancy (which
 * key-encryption key wraps it) and — when the write version needs one —
 * the location of the secret in the resource model (which vault KV path
 * stores its value).
 *
 * Exists as a type (rather than bare strings threaded through encrypt) so
 * a call site cannot pass unvalidated or empty values, and so the
 * tenant-name derivation lives in exactly one place.
 *
 * The tenant segment — one discriminator for keys and paths:
 * `tenantSegment` is `org-<slug>` for organization-scoped resources and
 * the literal `platform` for platform-scoped ones. The same string is the
 * Transit key name (kekKeyName) and the KV path root, deliberately: the
 * `org-` prefix makes an organization literally named "platform"
 * collision-free in both namespaces at once.
 *
 * Located scopes (v3 writes): the vault-backed enc:v3: codec derives a KV
 * path `{tenant}/{kind}/{id}/{key}` (enc-v3-wire-format.md in the vault
 * migration project docs), so v3 writes need a scope carrying kind and id
 * — built with forOrganizationResource / forPlatformResource. The v1/v2
 * codecs ignore location entirely, so their call sites use
 * forOrganization unchanged (the pre-v3 posture, kept deliberately —
 * write paths adopt located scopes only when a v3 write flip demands
 * them). keyName names the secret for SINGULAR encrypts (withKeyName);
 * batch encrypts take key names from their map keys instead.
 *
 * Validation: org slugs must match the org-slug contract from
 * ai.stigmer.commons.apiresource metadata.proto
 * (^[a-z][a-z0-9-]*[a-z0-9]$, min 2 chars). That charset is safe as a
 * Transit key name and as a KV path segment, so passing validation here
 * guarantees the derived names need no escaping. The check matters even
 * though callers read the org from server state, not client input: a
 * malformed slug reaching a crypto key name would otherwise fail deep
 * inside the vault with a routing error naming nothing.
 */

/** The reserved tenant segment for platform-scoped resources. */
export const PLATFORM_TENANT = "platform";

/** Prefix of organization tenant segments; what makes PLATFORM_TENANT unclaimable. */
const ORG_TENANT_PREFIX = "org-";

/**
 * The org-slug contract from metadata.proto, verbatim. Kept in lockstep
 * with the proto: a value that passes resource validation always passes
 * here.
 */
const ORG_SLUG = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** Resource kinds are server-side constants: lowercase, no separators. */
const KIND = /^[a-z][a-z0-9]*$/;

export class EncryptionScope {
  private constructor(
    /** `org-<slug>` or `platform` — the Transit key name and KV path root. */
    readonly tenantSegment: string,
    /** The resource kind, lowercase (undefined when not located). */
    readonly kind: string | undefined,
    /** The resource's immutable identity (undefined exactly when kind is). */
    readonly id: string | undefined,
    /** The secret's key name for singular encrypts (undefined for batch calls). */
    readonly keyName: string | undefined,
  ) {}

  /**
   * A tenancy-only scope — all a v1/v2 write needs. The long-standing
   * factory; every pre-v3 call site uses exactly this.
   */
  static forOrganization(orgSlug: string): EncryptionScope {
    return new EncryptionScope(
      orgSegment(orgSlug),
      undefined,
      undefined,
      undefined,
    );
  }

  /**
   * A located org-scoped scope, as v3 batch writes need: the KV path root
   * is `org-<slug>/<kind>/<id>`, key names come from the batch map keys.
   */
  static forOrganizationResource(
    orgSlug: string,
    kind: string,
    id: string,
  ): EncryptionScope {
    validateLocation(kind, id);
    return new EncryptionScope(orgSegment(orgSlug), kind, id, undefined);
  }

  /**
   * A located platform-scoped scope (e.g. CursorAccount in the cloud
   * composition): the KV path root is `platform/<kind>/<id>` and the KEK
   * is the reserved PLATFORM_TENANT Transit key.
   */
  static forPlatformResource(kind: string, id: string): EncryptionScope {
    validateLocation(kind, id);
    return new EncryptionScope(PLATFORM_TENANT, kind, id, undefined);
  }

  /**
   * This scope with the secret's key name attached — for SINGULAR
   * encrypts, where no batch map key can name the secret. Requires a
   * located scope.
   */
  withKeyName(keyName: string): EncryptionScope {
    if (this.kind === undefined) {
      throw new Error(
        `encryption scope keyName requires a located scope (kind + id) - keyName '${keyName}' names a secret inside a resource`,
      );
    }
    if (keyName === "") {
      throw new Error("encryption scope keyName must not be empty");
    }
    return new EncryptionScope(this.tenantSegment, this.kind, this.id, keyName);
  }

  /** Whether this scope names a resource location (required for v3 writes). */
  isLocated(): boolean {
    return this.kind !== undefined;
  }

  /**
   * The Transit key name that wraps data keys for this scope — identical
   * to tenantSegment by design (see the module header).
   */
  kekKeyName(): string {
    return this.tenantSegment;
  }
}

function orgSegment(orgSlug: string): string {
  if (!ORG_SLUG.test(orgSlug)) {
    throw new Error(
      `encryption scope requires a valid org slug (pattern ${ORG_SLUG.source}), got: '${orgSlug}'`,
    );
  }
  return ORG_TENANT_PREFIX + orgSlug;
}

function validateLocation(kind: string, id: string): void {
  if (!KIND.test(kind)) {
    throw new Error(
      `encryption scope kind must be a lowercase server-side constant (pattern ${KIND.source}), got: '${kind}'`,
    );
  }
  if (id.trim() === "") {
    throw new Error("encryption scope id must not be blank");
  }
}
