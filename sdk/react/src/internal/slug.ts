/**
 * Generates a short random suffix suitable for use in resource slugs.
 *
 * Returns 8 lowercase hex characters derived from `crypto.randomUUID()`,
 * providing ~4.3 billion combinations per (org, kind) pair. The output
 * satisfies the platform slug pattern `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
export function generateSlugSuffix(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
