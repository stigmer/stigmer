/**
 * Named-key loader — ports pkg/encryption/keymanager.go.
 *
 * One convention for every key the server holds: env var (Base64) →
 * ~/.stigmer/<file> (0600) → auto-generate and persist. The
 * loader is generalized over the env var, the file name and a KeyCodec so
 * sibling key material rides the same ladder instead of growing a
 * divergent loader: the runner-token signing key (oss#535) and the
 * encryption key are 32 raw bytes (RAW_32_BYTE_KEY); the platform-token
 * signing key is an RSA private key (platformtoken/key-ring.ts). The codec
 * says what a key IS — how an env value and a file decode, how one is
 * generated and written — and nothing about the ladder, which stays one.
 *
 * Ladder semantics, exactly Go's, for every codec:
 *   - An EXPLICITLY configured env key that is unusable (bad Base64, wrong
 *     length, not the key type the codec holds) is an ERROR, never a
 *     degrade — silently ignoring deliberate configuration would be worse
 *     than refusing to boot.
 *   - A key file that fails its load checks (permissions other than 0600,
 *     content the codec does not accept) is never adopted; the ladder
 *     FALLS THROUGH to auto-generate, which overwrites the file's content —
 *     Go's shipped behavior (loadKeyFromFile error → generate → save),
 *     ported as-is.
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
 * What one kind of key is, for the ladder. `fromEnv` receives the env
 * value already strictly Base64-decoded and THROWS when the bytes are not
 * a usable key (explicit configuration is never silently ignored);
 * `fromFile` answers `undefined` for content it does not accept, so the
 * ladder falls through exactly as it does for a wrong-sized raw key.
 */
export interface KeyCodec<Key> {
  fromEnv(envVar: string, decoded: Buffer): Key;
  fromFile(content: Buffer): Key | undefined;
  generate(): Key;
  toFile(key: Key): Buffer;
}

/** The 32 raw bytes the encryption and runner-token keys are. */
export const RAW_32_BYTE_KEY: KeyCodec<Buffer> = {
  fromEnv(envVar, decoded) {
    if (decoded.length !== KEY_SIZE) {
      throw new Error(
        `${envVar} must be exactly 32 bytes (256 bits) when decoded, got ${decoded.length} bytes`,
      );
    }
    return decoded;
  },
  fromFile(content) {
    return content.length === KEY_SIZE ? content : undefined;
  },
  generate() {
    return randomBytes(KEY_SIZE);
  },
  toFile(key) {
    return key;
  },
};

/**
 * Go GetOrCreateNamedKey: env var → key file → auto-generate, for a 32-byte
 * raw key. Throws only on unusable EXPLICIT configuration (bad env value)
 * or when no key can be produced at all.
 */
export function getOrCreateNamedKey(
  envVar: string,
  fileName: string,
  options: KeyLoaderOptions = {},
): Buffer {
  return getOrCreateKey(RAW_32_BYTE_KEY, envVar, fileName, options);
}

/** The ladder over any codec: env var → key file → auto-generate. */
export function getOrCreateKey<Key>(
  codec: KeyCodec<Key>,
  envVar: string,
  fileName: string,
  options: KeyLoaderOptions = {},
): Key {
  const env = options.env ?? process.env;

  // 1. Environment variable (highest priority) — Base64-encoded.
  const envValue = env[envVar];
  if (envValue !== undefined && envValue !== "") {
    return codec.fromEnv(envVar, decodeEnvBase64(envVar, envValue));
  }

  // 2. Local key file — refused on insecure permissions or content the
  //    codec does not accept.
  const keyPath = namedKeyFilePath(fileName, options);
  const content = readKeyFile(keyPath);
  const fromFile = content === undefined ? undefined : codec.fromFile(content);
  if (fromFile !== undefined) {
    return fromFile;
  }

  // 3. Auto-generate (local development); persist for future boots.
  const key = codec.generate();
  try {
    saveKeyToFile(keyPath, codec.toFile(key));
  } catch (error) {
    // Warn but don't fail — the key is still usable (Go's posture).
    process.stderr.write(
      `Warning: could not save key to ${keyPath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  return key;
}

/** Strict Base64 decode for an env-configured key. */
function decodeEnvBase64(envVar: string, value: string): Buffer {
  const decoded = Buffer.from(value, "base64");
  // Node's base64 decoder is lenient (skips invalid characters, accepts
  // missing padding) and never throws; Go's StdEncoding errors on any
  // non-canonical input. Round-tripping — Buffer always re-emits the
  // canonical padded form — restores Go's strictness.
  if (decoded.toString("base64") !== value) {
    throw new Error(`invalid Base64 encoding in ${envVar}`);
  }
  return decoded;
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
 * Reads a key file's bytes, mirroring Go loadKeyFromFile: missing file →
 * undefined (fall through the ladder); present with insecure permissions
 * also falls through — exactly Go's behavior, where any load error falls
 * to auto-generate. The 0600 check is skipped on Windows, where POSIX
 * modes are not meaningful.
 */
function readKeyFile(keyPath: string): Buffer | undefined {
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
  try {
    return fs.readFileSync(keyPath);
  } catch {
    return undefined;
  }
}

/** Writes the key with secure permissions (dir 0700, file 0600). */
function saveKeyToFile(keyPath: string, content: Buffer): void {
  fs.mkdirSync(path.dirname(keyPath), {
    recursive: true,
    mode: KEY_DIR_PERMISSIONS,
  });
  fs.writeFileSync(keyPath, content, { mode: KEY_FILE_PERMISSIONS });
}
