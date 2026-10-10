/**
 * The loopback certificate (`agent-proxy/loopback-certificate.ts`), proved
 * the way the agent host uses it.
 *
 * Pinned:
 *  - Node's X.509 parser reads it: self-signed, for IP 127.0.0.1, valid now
 *    and for years, signed by its own key;
 *  - a TLS client that trusts it completes a handshake with a server that
 *    serves it, on 127.0.0.1, over HTTP/2;
 *  - a client that trusts something else refuses it, and each mint is a
 *    different key.
 */

import { X509Certificate, createPublicKey } from "node:crypto";
import { connect, createSecureServer, type Http2SecureServer } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { mintLoopbackCertificate } from "../loopback-certificate.js";

let server: Http2SecureServer | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

async function serve(certPem: string, keyPem: string): Promise<number> {
  server = createSecureServer({ cert: certPem, key: keyPem }, (_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("over loopback TLS");
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function get(port: number, ca: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const session = connect(`https://127.0.0.1:${port}`, { ca });
    session.on("error", reject);
    const req = session.request({ ":path": "/" });
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      session.close();
      resolve(body);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the loopback certificate", () => {
  it("is a self-signed certificate for 127.0.0.1, valid for years, signed by its own key", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const { certPem, keyPem } = mintLoopbackCertificate(now);
    const cert = new X509Certificate(certPem);

    expect(cert.subject).toBe("CN=stigmer agent proxy");
    expect(cert.issuer).toBe(cert.subject);
    expect(cert.checkIP("127.0.0.1")).toBe("127.0.0.1");
    expect(cert.checkHost("example.com")).toBeUndefined();
    expect(new Date(cert.validFrom).getTime()).toBeLessThan(now.getTime());
    expect(new Date(cert.validTo).getUTCFullYear()).toBe(2036);
    expect(cert.verify(createPublicKey(keyPem))).toBe(true);
  });

  it("completes an HTTP/2 handshake for a client that trusts it, and only for one", async () => {
    const minted = mintLoopbackCertificate();
    const port = await serve(minted.certPem, minted.keyPem);

    expect(await get(port, minted.certPem)).toBe("over loopback TLS");
    await expect(get(port, mintLoopbackCertificate().certPem)).rejects.toThrow(/self[- ]signed|unable to verify|certificate/i);
  });

  it("is a new key at every mint", () => {
    expect(mintLoopbackCertificate().keyPem).not.toBe(mintLoopbackCertificate().keyPem);
  });
});
