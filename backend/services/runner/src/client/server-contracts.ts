/**
 * Server Contract Validation
 *
 * Encodes server-side pipeline requirements that the proto schema does not
 * express. The Java backend's `ResolveSlugStepV2`, `AuthorizeStep`, and
 * `ValidateSessionOrAgentStep` enforce business rules beyond protovalidate
 * annotations. These guards catch violations at the client before they
 * reach the wire, producing actionable error messages.
 *
 * Background: `ApiResourceMetadata.name` and `.slug` are proto-optional
 * (IGNORE_IF_ZERO_VALUE), but the server's ResolveSlugStepV2 requires at
 * least one on resource creation (when id is absent). This mismatch caused
 * the same class of bug three times (Jan 2026 CLI, May 2026 runner).
 */

export class ServerContractError extends Error {
  constructor(caller: string, detail: string) {
    super(`[ServerContract] ${caller}: ${detail}`);
    this.name = "ServerContractError";
  }
}

interface ResourceMetadata {
  name?: string;
  slug?: string;
  id?: string;
  org?: string;
}

interface ResourceEnvelope {
  apiVersion?: string;
  kind?: string;
  metadata?: ResourceMetadata;
}

interface ResourceReference {
  org?: string;
  slug?: string;
  kind?: number;
}

const STIGMER_API_VERSION = "agentic.stigmer.ai/v1";

/**
 * Validates that a resource being created satisfies the server's pipeline
 * requirements for the CREATE path:
 *
 * 1. ResolveSlugStepV2: metadata.slug or metadata.name required (when id absent)
 * 2. AuthorizeStep: metadata.org required for organization-scoped authorization
 * 3. Envelope: apiVersion and kind must match expected values
 */
export function assertCreateRequirements(
  resource: ResourceEnvelope,
  expectedKind: string,
  caller: string,
): void {
  if (resource.apiVersion !== STIGMER_API_VERSION) {
    throw new ServerContractError(
      caller,
      `apiVersion must be "${STIGMER_API_VERSION}" (got "${resource.apiVersion ?? ""}"). ` +
      `Set apiVersion when constructing the proto with create().`,
    );
  }

  if (resource.kind !== expectedKind) {
    throw new ServerContractError(
      caller,
      `kind must be "${expectedKind}" (got "${resource.kind ?? ""}"). ` +
      `Set kind when constructing the proto with create().`,
    );
  }

  const meta = resource.metadata;
  if (!meta) {
    throw new ServerContractError(caller, `${expectedKind} requires metadata to be set.`);
  }

  if (!meta.id && !meta.slug && !meta.name) {
    throw new ServerContractError(
      caller,
      `${expectedKind} requires metadata.name or metadata.slug for creation. ` +
      `The server's ResolveSlug step generates a slug from the name. ` +
      `Provide a name like "${expectedKind.toLowerCase()}-{context}-{timestamp}".`,
    );
  }

  if (!meta.org) {
    throw new ServerContractError(
      caller,
      `${expectedKind} requires metadata.org for authorization. ` +
      `The server's Authorize step uses org to check permissions.`,
    );
  }
}

/**
 * Validates that an ApiResourceReference has the fields required by
 * the server's getByReference handlers.
 *
 * Proto declares slug as `required = true`, but generated TypeScript types
 * do not enforce this at runtime. The server's handler also requires org
 * for scoped lookups.
 */
export function assertReferenceRequirements(
  ref: ResourceReference,
  resourceKind: string,
  caller: string,
): void {
  if (!ref.slug) {
    throw new ServerContractError(
      caller,
      `${resourceKind} reference requires a non-empty slug. ` +
      `If the slug came from placeholder resolution, the referenced ` +
      `secret or env var may be missing.`,
    );
  }

  if (!ref.org) {
    throw new ServerContractError(
      caller,
      `${resourceKind} reference requires org for scoped lookup. ` +
      `Pass the organization slug or ensure it is available in the runtime context.`,
    );
  }
}
