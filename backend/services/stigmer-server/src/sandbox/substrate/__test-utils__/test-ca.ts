/**
 * A throwaway certificate authority for the router transport's suite: a CA
 * and server certificates signed by it, minted in memory at test time, so
 * the suite runs real TLS handshakes with no key material in the tree and
 * nothing that expires on disk. ECDSA P-256 keeps minting fast.
 *
 * `reflect-metadata` is the polyfill @peculiar/x509's dependency injection
 * needs loaded before it.
 */
import "reflect-metadata";

import { webcrypto } from "node:crypto";

import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto);

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
const VALIDITY_MS = 60 * 60 * 1000;

export interface TestCa {
  readonly pem: string;
  readonly certificate: x509.X509Certificate;
  readonly keys: webcrypto.CryptoKeyPair;
}

export interface TestServerCertificate {
  readonly cert: string;
  readonly key: string;
}

export async function mintCa(name: string): Promise<TestCa> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ]);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${name}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + VALIDITY_MS),
    keys,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
    ],
  });
  return { pem: certificate.toString("pem"), certificate, keys };
}

/** A server certificate for the given DNS names and IP addresses, signed by `ca`. */
export async function mintServerCertificate(
  ca: TestCa,
  names: { readonly dns?: readonly string[]; readonly ip?: readonly string[] },
): Promise<TestServerCertificate> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ]);
  const certificate = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=router",
    issuer: ca.certificate.subject,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + VALIDITY_MS),
    signingKey: ca.keys.privateKey,
    publicKey: keys.publicKey,
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.SubjectAlternativeNameExtension([
        ...(names.dns ?? []).map((value) => ({ type: "dns" as const, value })),
        ...(names.ip ?? []).map((value) => ({ type: "ip" as const, value })),
      ]),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
  return {
    cert: certificate.toString("pem"),
    key: x509.PemConverter.encode(pkcs8, "PRIVATE KEY"),
  };
}
