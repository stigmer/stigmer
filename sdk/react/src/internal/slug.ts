/**
 * Derives a URL-friendly slug from a human-readable name.
 *
 * This mirrors the backend `GenerateSlug` logic (Go: `steps/slug.go`,
 * Java: `ApiRequestResourceSlugGenerator`) so the frontend can preview
 * the exact slug that the server would produce.
 *
 * Rules (applied in order):
 * 1. Convert to lowercase
 * 2. Replace spaces and dots (namespace separators) with hyphens
 * 3. Strip everything except `a-z`, `0-9`, and `-`
 * 4. Collapse consecutive hyphens into one
 * 5. Trim leading / trailing hyphens
 *
 * Dots are treated as namespace separators (e.g. `platform.sara` → `platform-sara`),
 * matching the backend generators, so namespace-scoped names stay readable.
 *
 * @example
 * ```ts
 * generateSlug("My Cool Agent")             // "my-cool-agent"
 * generateSlug("Acme Corp!")                // "acme-corp"
 * generateSlug("  --hello-- ")              // "hello"
 * generateSlug("platform.planton-arch")     // "platform-planton-arch"
 * generateSlug("")                          // ""
 * ```
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ .]/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
