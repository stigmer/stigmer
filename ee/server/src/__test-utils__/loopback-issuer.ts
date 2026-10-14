/**
 * OpenID issuers on a loopback port, for a composed suite whose people sign
 * in through the library's own OIDC lane and through an organization's
 * federation issuer. One HTTP server serves any number of named issuers at
 * `<base>/<name>`, each with its discovery document, its key set and its
 * userinfo endpoint; every issuer signs with one RS256 key, made here and
 * kept in memory.
 *
 * Two spellings of one issuer, because the two lanes read issuers by
 * different rules:
 *   - `issuerUrl(name)`, http: the library's own OIDC lane accepts http on
 *     a loopback address, and dials the server directly;
 *   - `tlsIssuerUrl(name)`, https: a federation issuer's issuers must be
 *     https. The suite hands the server's `fetch` to the composition as the
 *     guarded fetch's dialer, so the composition's egress posture judges
 *     every address as it would in production, and only the final dial is
 *     answered over the plain socket. The documents an issuer serves name
 *     the spelling the request asked for, so the discovery binding holds.
 *
 * `/userinfo` answers the bearer token's own claims, overlaid with the
 * profile the suite set for the subject (`setProfile`), so a profile that
 * changes "at the provider" is observable to the server.
 */
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

/** A subject's profile as the issuer's userinfo endpoint answers it. */
export interface LoopbackProfile {
  readonly email?: string;
  readonly given_name?: string;
  readonly family_name?: string;
}

/** What a minted token carries beyond the issuer. */
export interface LoopbackClaims {
  readonly sub: string;
  readonly aud: string;
  readonly email?: string;
  /** Mint under the issuer's https spelling (a federation issuer's token). */
  readonly tls?: boolean;
  /** Any further claims, as given. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

export interface LoopbackIssuer {
  /** The http spelling of `name`'s issuer. */
  issuerUrl(name: string): string;
  /** The https spelling of `name`'s issuer, answered through `fetch`. */
  tlsIssuerUrl(name: string): string;
  /** An RS256 access token from `name`'s issuer, valid for five minutes. */
  mint(name: string, claims: LoopbackClaims): string;
  /** The profile `name`'s userinfo answers for `sub`, over the token's own claims. */
  setProfile(name: string, sub: string, profile: LoopbackProfile): void;
  /**
   * A dialer that answers this server's https spelling over its plain
   * socket and passes every other URL to the platform's fetch.
   */
  readonly fetch: typeof fetch;
  close(): Promise<void>;
}

const KEY_ID = "loopback";
const SCHEME_HEADER = "x-loopback-scheme";

function segment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export async function startLoopbackIssuer(): Promise<LoopbackIssuer> {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...keys.publicKey.export({ format: "jwk" }), kid: KEY_ID, alg: "RS256", use: "sig" };
  const profiles = new Map<string, LoopbackProfile>();
  let base = "";
  let host = "";

  function spelled(scheme: "http" | "https", name: string): string {
    return `${scheme}://${host}/${name}`;
  }

  function answer(res: ServerResponse, status: number, body?: unknown): void {
    res.statusCode = status;
    if (body !== undefined) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    } else {
      res.end();
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse): void {
    const scheme = req.headers[SCHEME_HEADER] === "https" ? "https" : "http";
    const path = new URL(req.url ?? "/", base).pathname;
    const match = /^\/([a-z0-9-]+)(\/.*)$/.exec(path);
    if (match === null) {
      answer(res, 404);
      return;
    }
    const name = match[1] ?? "";
    const route = match[2] ?? "";
    const issuer = spelled(scheme, name);
    if (route === "/.well-known/openid-configuration") {
      answer(res, 200, { issuer, jwks_uri: `${issuer}/jwks`, userinfo_endpoint: `${issuer}/userinfo` });
      return;
    }
    if (route === "/jwks") {
      answer(res, 200, { keys: [jwk] });
      return;
    }
    if (route === "/userinfo") {
      const header = req.headers.authorization ?? "";
      const payload = header.startsWith("Bearer ") ? header.slice("Bearer ".length).split(".")[1] : undefined;
      if (payload === undefined) {
        answer(res, 401);
        return;
      }
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        sub?: string;
        email?: string;
      };
      const sub = claims.sub ?? "";
      answer(res, 200, {
        sub,
        email: claims.email ?? "",
        given_name: "Loopback",
        family_name: "Person",
        ...(profiles.get(`${name}\u0000${sub}`) ?? {}),
      });
      return;
    }
    answer(res, 404);
  }

  const server = createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("the loopback issuer has no port");
  }
  host = `127.0.0.1:${address.port}`;
  base = `http://${host}`;

  const dial: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.protocol !== "https:" || url.host !== host) {
      return fetch(input, init);
    }
    const headers = new Headers(init?.headers);
    headers.set(SCHEME_HEADER, "https");
    return fetch(`${base}${url.pathname}${url.search}`, { ...init, headers });
  };

  return {
    issuerUrl: (name) => spelled("http", name),
    tlsIssuerUrl: (name) => spelled("https", name),
    mint(name, claims): string {
      const now = Math.floor(Date.now() / 1000);
      const header = segment({ alg: "RS256", typ: "JWT", kid: KEY_ID });
      const payload = segment({
        ...(claims.extra ?? {}),
        iss: spelled(claims.tls === true ? "https" : "http", name),
        aud: claims.aud,
        sub: claims.sub,
        ...(claims.email === undefined ? {} : { email: claims.email }),
        iat: now,
        exp: now + 300,
        jti: randomUUID(),
      });
      const signer = createSign("RSA-SHA256");
      signer.update(`${header}.${payload}`);
      return `${header}.${payload}.${signer.sign(keys.privateKey).toString("base64url")}`;
    },
    setProfile(name, sub, profile): void {
      profiles.set(`${name}\u0000${sub}`, profile);
    },
    fetch: dial,
    async close(): Promise<void> {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}
