/**
 * The secret-safety gate for CAS capture (design doc 12).
 *
 * The git substrate never captures gitignored paths, which was an accidental
 * safety property: `.gitignore` is where projects keep secrets (`.env`, private
 * keys, credentials). The CAS substrate's whole purpose is to start capturing
 * ignored / non-git paths — so, done naively, it would write secret bytes into
 * durable artifact storage. This module is the fail-closed gate that prevents
 * that: a path classified secret-like is BLOCKED from capture (authored as
 * DIFF_UNREVIEWABLE instead) and its bytes never leave the workspace.
 *
 * Scope discipline (design doc 12 D2): this is deliberately a small, explicit,
 * deterministic matcher — NOT the Phase-4 `sensitivity` taxonomy, NOT ML. It is
 * a pure function over the path, so the cross-edition corpus can lock it (a path
 * either blocks or captures, identically everywhere). The matcher errs toward
 * blocking: a path only needs to LOOK secret-like to be withheld, because the
 * cost of withholding a non-secret (it stays on the deny-gate, as today) is far
 * lower than the cost of persisting a real secret.
 *
 * @since File-Change HITL Redesign (Phase 3 — CAS / DD-E)
 */

/**
 * Basename patterns that mark a file secret-like. Matched case-insensitively
 * against the final path segment. Kept as an explicit, reviewable list — adding
 * a pattern is a deliberate, corpus-locked change, never a heuristic guess.
 */
export const SECRET_BASENAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..+)?$/, // .env, .env.local, .env.production, ...
  /^\.npmrc$/,
  /^\.netrc$/,
  /^\.pgpass$/,
  /^\.htpasswd$/,
  /^credentials(\.[A-Za-z0-9]+)?$/, // credentials, credentials.json, ...
  /^secrets?(\.[A-Za-z0-9]+)?$/, // secret / secrets / secrets.yaml, ...
  /^id_(rsa|dsa|ecdsa|ed25519)$/, // private SSH keys (no .pub)
  /.*\.(pem|key|pfx|p12|keystore|jks|asc|ppk)$/,
  /.*\.tfstate(\.backup)?$/, // terraform state embeds secrets
  /.*\.tfvars$/,
  /.*\.(kdbx)$/, // password databases
];

/**
 * Path-fragment patterns that mark a file secret-like by WHERE it lives, matched
 * against the normalized (forward-slash) full path. Covers credential stores
 * whose basenames alone are ambiguous.
 */
export const SECRET_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.ssh\//, // ~/.ssh/* and repo-local .ssh/*
  /(^|\/)\.aws\/credentials$/,
  /(^|\/)\.gnupg\//,
  /(^|\/)\.docker\/config\.json$/,
  /(^|\/)\.kube\/config$/,
];

/** The final path segment (basename), for both `/` and `\` separators. */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

/**
 * Whether a path is secret-like and must NOT be captured into the durable CAS
 * store. Fail-closed: an empty/unknown path is treated as secret-like (withheld)
 * rather than captured.
 */
export function isSecretLikePath(path: string): boolean {
  if (!path) return true;
  const normalized = path.replace(/\\/g, "/");
  const base = basename(normalized).toLowerCase();

  for (const re of SECRET_BASENAME_PATTERNS) {
    if (re.test(base)) return true;
  }
  const lowerPath = normalized.toLowerCase();
  for (const re of SECRET_PATH_PATTERNS) {
    if (re.test(lowerPath)) return true;
  }
  return false;
}
