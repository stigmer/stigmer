/**
 * Deterministic sandbox object naming — generalized from the cloud
 * edition's SandboxObjectNaming.java so both container drivers (and the
 * cloud's own provisioner) name sandboxes identically: an operator
 * moving between tiers sees one vocabulary.
 *
 * Base name: sbx-<scope-code>-<first 12 hex chars of SHA-256(id)> —
 * DNS-1123-safe regardless of the id's alphabet or length (resource ids
 * carry prefixes like ses_ that DNS labels reject; hashing sidesteps
 * every alphabet/length edge). The full id travels in a label so the
 * mapping is recoverable from the runtime object alone (gate ruling Q4:
 * runtime-derived state, no store tables).
 */
import { createHash } from "node:crypto";

import type { SandboxScope } from "./provisioner.js";

/** The Java SandboxScope codes, byte-identical. */
const SCOPE_CODES: Record<SandboxScope, string> = {
  session: "ses",
  workflow: "wfx",
  connect: "mcp",
};

/** Label carrying the owning driver ("stigmer-server") — the reap/list filter. */
export const SANDBOX_MANAGED_BY_LABEL = "stigmer.ai/managed-by";
/** Label carrying the scope ("session" | "workflow" | "connect"). */
export const SANDBOX_SCOPE_LABEL = "stigmer.ai/scope";
/** Label carrying the full owning resource id (the Q4 runtime-derived link). */
export const SANDBOX_ID_LABEL = "stigmer.ai/sandbox-id";

export const SANDBOX_MANAGED_BY_VALUE = "stigmer-server";

/** sbx-<code>-<12-hex> (SandboxObjectNaming.java's derivation, kept exactly). */
export function sandboxBaseName(scope: SandboxScope, id: string): string {
  const digest = createHash("sha256").update(id).digest("hex").slice(0, 12);
  return `sbx-${SCOPE_CODES[scope]}-${digest}`;
}
