/**
 * LLM provider-backend utilities — pure routing helpers for serving a
 * provider's models through an alternative cloud backend (GCP Vertex AI,
 * and later AWS Bedrock / Azure OpenAI) instead of the provider's public API.
 *
 * Layering mirrors `llm-proxy.ts`: this module is pure string/config
 * utilities with no LangChain or SDK dependency. The LangChain-aware wiring
 * (the `createClient` factory branch in `model-client.ts`) consumes these
 * helpers; see `__tests__/vertex-seam.test.ts` for the pinned seam behavior.
 *
 * Design decision record: stigmer-cloud
 * `_projects/2026-08/20260809.01.multi-cloud-llm-provider-endpoints/`
 * `design-decisions/001-provider-backends.md`.
 */

/**
 * Matches a registry `apiModelId` that ends in a pre-4.6 snapshot date
 * (`-YYYYMMDD`), e.g. "claude-sonnet-4-5-20250929".
 */
const TRAILING_SNAPSHOT_DATE = /-(\d{8})$/;

/**
 * Translate a canonical Anthropic API model id into Vertex AI's form.
 *
 * The model registry serves two id shapes, and Vertex treats them
 * differently (platform.claude.com "Model IDs and versions"):
 *
 * - Pre-4.6 models carry a snapshot date, and Vertex separates it with `@`
 *   instead of `-`: "claude-sonnet-4-5-20250929" -> "claude-sonnet-4-5@20250929".
 * - 4.6-generation and later ids are dateless AND canonical on every
 *   platform: "claude-sonnet-4-6" is used verbatim on Vertex. Appending a
 *   date to them 404s — a real bug shipped by other integrations (Dify
 *   langgenius/dify-official-plugins#2905, Roo-Code #11625) — so dateless
 *   ids MUST pass through untouched.
 *
 * The translated id is Vertex wire detail only: it goes into the request
 * URL path and must never escape the adapter into usage metrics or pricing,
 * which key on the canonical id (the canonical-id invariant in the design
 * decision record).
 *
 * Already-translated ids (`name@date`) and Bedrock-shaped ids
 * (`anthropic.…-v1:0`) don't match the trailing-date pattern, so a second
 * pass is a no-op by construction.
 */
export function toVertexModelId(apiModelId: string): string {
  return apiModelId.replace(TRAILING_SNAPSHOT_DATE, "@$1");
}
