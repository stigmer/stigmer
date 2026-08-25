/**
 * Named-key loader — ports pkg/encryption/keymanager.go.
 *
 * One convention for every 32-byte key the server holds (sub-project
 * DD-002): env var (Base64) → ~/.stigmer/<file> (raw bytes, 0600) →
 * auto-generate and persist. The loader is generalized over the env var
 * and file name so sibling key material (the runner-token signing key,
 * oss#535) rides the same ladder instead of growing a divergent loader.
 *
 * Ladder semantics, exactly Go's:
 *   - An EXPLICITLY configured env key that is unusable (bad Base64, wrong
 *     length) is an ERROR, never a degrade — silently ignoring deliberate
 *     configuration would be worse than refusing to boot.
 *   - A key file that fails its load checks (permissions other than 0600,
 *     wrong size) is never adopted; the ladder FALLS THROUGH to
 *     auto-generate, which overwrites the file's content — Go's shipped
 *     behavior (loadKeyFromFile error → generate → save), ported as-is.
 *   - Auto-generation persists for future boots; a persist FAILURE is a
 *     stderr warning only — the key is still usable for this process.
 *
 * `env` and `homeDir` are injectable with process defaults — the
 * loadConfig(env = process.env) idiom (boot/config.ts) — so unit tests
 * stay hermetic and never touch the real ~/.stigmer (DD-002). The key env
 * vars deliberately do NOT ride ServerConfig: Go's pkg/config never sees
 * them either, and config.ts's contract is that no entry exists before
 * the code that reads it.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** AES-256 / HMAC-SHA256 key size (32 bytes = 256 bits) — Go KeySize. */
export const KEY_SIZE = 32;

/** Directory under home for key files — Go KeyFileDir. */
export const KEY_FILE_DIR = ".stigmer";

/** Key file permissions (owner read/write only) — Go KeyFilePermissions. */
export const KEY_FILE_PERMISSIONS = 0o600;

/** Key directory permissions — Go KeyDirPermissions. */
export const KEY_DIR_PERMISSIONS = 0o700;

export interface KeyLoaderOptions {
  /** Environment map; defaults to the live process env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Home directory for ~/.stigmer; defaults to os.homedir(). */
  readonly homeDir?: string;
}

/**
 * Go GetOrCreateNamedKey: env var → key file → auto-generate. Throws only
 * on unusable EXPLICIT configuration (bad env value) or when no key can be
 * produced at all.
 */
export function getOrCreateNamedKey(
  envVar: string,
  fileName: string,
  options: KeyLoaderOptions = {},
): Buffer {
  const env = options.env ?? process.env;

  // 1. Environment variable (highest priority) — Base64-encoded 32 bytes.
  const envValue = env[envVar];
  if (envValue !== undefined && envValue !== "") {
    return decodeEnvKey(envVar, envValue);
  }

  // 2. Local key file — raw 32 bytes, refused on insecure permissions.
  const keyPath = namedKeyFilePath(fileName, options);
  const fromFile = loadKeyFromFile(keyPath);
  if (fromFile !== undefined) {
    return fromFile;
  }

  // 3. Auto-generate (local development); persist for future boots.
  const key = randomBytes(KEY_SIZE);
  try {
    saveKeyToFile(keyPath, key);
  } catch (error) {
    // Warn but don't fail — the key is still usable (Go's posture).
    process.stderr.write(
      `Warning: could not save key to ${keyPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return key;
}

/** Strict Base64 decode + length check for an env-configured key. */
function decodeEnvKey(envVar: string, value: string): Buffer {
  const key = Buffer.from(value, "base64");
  // Node's base64 decoder is lenient (skips invalid characters, accepts
  // missing padding) and never throws; Go's StdEncoding errors on any
  // non-canonical input. Round-tripping — Buffer always re-emits the
  // canonical padded form — restores Go's strictness.
  if (key.toString("base64") !== value) {
    throw new Error(`invalid Base64 encoding in ${envVar}`);
  }
  if (key.length !== KEY_SIZE) {
    throw new Error(
      `${envVar} must be exactly 32 bytes (256 bits) when decoded, got ${key.length} bytes`,
    );
  }
  return key;
}

/** Path to a named key file under <home>/.stigmer. */
export function namedKeyFilePath(
  fileName: string,
  options: KeyLoaderOptions = {},
): string {
  const home = options.homeDir ?? os.homedir();
  return path.join(home, KEY_FILE_DIR, fileName);
}

/**
 * Reads raw key bytes, mirroring Go loadKeyFromFile: missing file →
 * undefined (fall through the ladder); present-but-wrong (insecure
 * permissions, wrong size) also falls through — exactly Go's behavior,
 * where any load error falls to auto-generate. The 0600 check is skipped
 * on Windows, where POSIX modes are not meaningful.
 */
function loadKeyFromFile(keyPath: string): Buffer | undefined {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(keyPath);
  } catch {
    return undefined;
  }
  if (process.platform !== "win32") {
    const mode = stat.mode & 0o777;
    if (mode !== KEY_FILE_PERMISSIONS) {
      return undefined;
    }
  }
  let key: Buffer;
  try {
    key = fs.readFileSync(keyPath);
  } catch {
    return undefined;
  }
  if (key.length !== KEY_SIZE) {
    return undefined;
  }
  return key;
}

/** Writes the key with secure permissions (dir 0700, file 0600). */
function saveKeyToFile(keyPath: string, key: Buffer): void {
  fs.mkdirSync(path.dirname(keyPath), {
    recursive: true,
    mode: KEY_DIR_PERMISSIONS,
  });
  fs.writeFileSync(keyPath, key, { mode: KEY_FILE_PERMISSIONS });
}
