/**
 * Computes a SHA-256 hex digest of the given bytes using Web Crypto.
 *
 * Returns the same 64-character lowercase hex string that the backend
 * produces for `SkillStatus.versionHash`, enabling client-side
 * duplicate detection before pushing.
 */
export async function computeArtifactHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
