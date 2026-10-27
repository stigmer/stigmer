/**
 * The PEM files the Substrate driver follows: the CA the Control API's
 * certificate chains to, the CA the router's certificate chains to, and
 * the router's client credential. Substrate rotates all three under a
 * running server (both CAs are its servicedns trust bundle, a refreshing
 * pool that carries the old and the new CA together across a rotation;
 * the credential is a podCertificate that lives a day), so each is read at
 * boot and read again whenever its mtime moves, never once for good
 * (stigmer#1841). A projected volume swaps its files by symlink, which
 * `statSync` follows.
 *
 * Every read is parsed, not only searched for a PEM marker: each
 * certificate block on its own with `X509Certificate` (which reads only
 * the first certificate of a bundle, so a bundle is split first), and the
 * credential's key with `createPrivateKey`. `tls.createSecureContext`
 * accepts a block whose body is garbage, so it is no check (stigmer#1854).
 * An unusable file is a boot throw naming its variable and its path; one
 * that becomes unusable later fails the call that read it, in the same
 * words, and the next call reads it again.
 *
 * A reader returns the same value until the file changes, so a caller
 * rebuilds its connections only on a change, comparing by identity.
 */
import { createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const PEM_BLOCK = /-----BEGIN ([A-Z ]+)-----[\s\S]*?-----END \1-----/g;
const CERTIFICATE_BEGIN = "-----BEGIN CERTIFICATE-----";

/** A client certificate: its private key and its chain, as PEM. */
export interface ClientCredential {
  readonly key: string;
  readonly cert: string;
}

/**
 * A CA bundle's certificates, as PEM. `purpose` completes "cannot be used
 * as ..." in an error: "the router's CA", "the Control API's CA".
 */
export function caFromFile(
  path: string,
  variable: string,
  purpose: string,
): () => string {
  return followFile(path, variable, purpose, (text) => {
    const certificates = pemBlocks(text).filter((block) =>
      block.startsWith(CERTIFICATE_BEGIN),
    );
    if (certificates.length === 0) {
      throw new Error(`${path} holds no PEM certificate`);
    }
    parseCertificates(certificates);
    return `${certificates.join("\n")}\n`;
  });
}

/** The client credential bundle a podCertificate projection writes: its key, then its chain. */
export function credentialFromFile(
  path: string,
  variable: string,
): () => ClientCredential {
  return followFile(
    path,
    variable,
    "the router's client certificate",
    (text) => {
      const blocks = pemBlocks(text);
      const key = blocks.find((block) =>
        /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(block),
      );
      const chain = blocks.filter((block) =>
        block.startsWith(CERTIFICATE_BEGIN),
      );
      if (key === undefined || chain.length === 0) {
        throw new Error(
          `${path} must hold a private key and its certificate chain as PEM`,
        );
      }
      try {
        createPrivateKey(key);
      } catch (error) {
        throw new Error(
          `its private key cannot be parsed: ${messageOf(error)}`,
        );
      }
      parseCertificates(chain);
      return { key, cert: `${chain.join("\n")}\n` };
    },
  );
}

/** Reads and parses `path` now, then again whenever its mtime moves (module header). */
function followFile<T>(
  path: string,
  variable: string,
  purpose: string,
  parse: (text: string) => T,
): () => T {
  const read = (): { mtimeMs: number; value: T } => {
    const mtimeMs = statSync(path).mtimeMs;
    return { mtimeMs, value: parse(readFileSync(path, "utf8")) };
  };
  const unusable = (error: unknown): Error =>
    new Error(
      `${variable} (${path}) cannot be used as ${purpose}: ${messageOf(error)}`,
      { cause: error },
    );
  let cached: { mtimeMs: number; value: T };
  try {
    cached = read();
  } catch (error) {
    throw unusable(error);
  }
  return () => {
    try {
      if (statSync(path).mtimeMs !== cached.mtimeMs) cached = read();
    } catch (error) {
      throw unusable(error);
    }
    return cached.value;
  };
}

function pemBlocks(text: string): string[] {
  return text.match(PEM_BLOCK) ?? [];
}

/** Parses each certificate on its own, naming the one that fails by its place in the file. */
function parseCertificates(certificates: readonly string[]): void {
  certificates.forEach((certificate, index) => {
    try {
      new X509Certificate(certificate);
    } catch (error) {
      throw new Error(
        `certificate ${index + 1} of ${certificates.length} cannot be parsed: ${messageOf(error)}`,
      );
    }
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
