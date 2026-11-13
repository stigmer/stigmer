// A small OpenID Connect issuer on loopback, for the CLI's sign-in tests.
//
// It publishes what `stigmer auth login` reads: the discovery document (with
// `device_authorization_endpoint` when `device` is on), `/authorize`, which
// checks S256 PKCE and the client, auto-consents and redirects with a code and
// the state, `/token` for the code, refresh and device grants, and
// `/device/code`. Device polls answer from a script (`deviceAnswers`:
// `authorization_pending`, `slow_down`, `access_denied`, `expired_token`,
// then `approve`), so each arm of the poll is reachable. Every form the
// issuer receives is kept, so a test can assert what the CLI sent.
//
// The shared hermetic issuer (`test/support`'s local-oidc-issuer) proves the
// same flows against a real server in the install layer; this one lives here
// because the CLI's unit suite imports no test package.

import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type DeviceAnswer =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "server_error"
  | "not_json"
  | "approve";

export interface FakeIssuerOptions {
  readonly clientId?: string;
  /** Publish the device endpoint. */
  readonly device?: boolean;
  /** How device polls are answered, in order; the last repeats. */
  readonly deviceAnswers?: readonly DeviceAnswer[];
  /** The issuer the discovery document names; defaults to the issuer's own address. */
  readonly documentIssuer?: (issuer: string) => string;
  /** How `/device/code` answers, in place of a device code (a refusal, or an answer missing its fields). */
  readonly deviceCodeAnswer?: { readonly status: number; readonly body: unknown };
  /** The state `/authorize` sends back, in place of the one it was given (a forged callback). */
  readonly stateOverride?: string;
}

export interface FakeIssuer {
  readonly issuer: string;
  readonly clientId: string;
  /** Every form POSTed to `/token` and `/device/code`, with its path. */
  readonly forms: Array<{ readonly path: string; readonly form: URLSearchParams }>;
  /** The authorize requests the browser made. */
  readonly authorizeRequests: URL[];
  close(): Promise<void>;
}

const USER_CODE = "ABCD-EFGH";

export async function startFakeIssuer(options: FakeIssuerOptions = {}): Promise<FakeIssuer> {
  const clientId = options.clientId ?? "native-client";
  const forms: FakeIssuer["forms"] = [];
  const authorizeRequests: URL[] = [];
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const deviceAnswers = [...(options.deviceAnswers ?? ["approve"])];
  let issuer = "";

  const tokens = (): Record<string, unknown> => ({
    access_token: `access-${randomBytes(6).toString("hex")}`,
    refresh_token: `refresh-${randomBytes(6).toString("hex")}`,
    token_type: "Bearer",
    expires_in: 300,
  });

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", issuer);
    if (url.pathname === "/.well-known/openid-configuration") {
      json(res, 200, {
        issuer: options.documentIssuer?.(issuer) ?? issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        ...(options.device === true ? { device_authorization_endpoint: `${issuer}/device/code` } : {}),
      });
      return;
    }
    if (url.pathname === "/authorize") {
      authorizeRequests.push(url);
      const q = url.searchParams;
      const redirectUri = q.get("redirect_uri") ?? "";
      if (q.get("client_id") !== clientId || q.get("code_challenge_method") !== "S256" || redirectUri === "") {
        json(res, 400, { error: "invalid_request" });
        return;
      }
      const code = randomBytes(12).toString("hex");
      codes.set(code, { challenge: q.get("code_challenge") ?? "", redirectUri });
      const target = new URL(redirectUri);
      target.searchParams.set("code", code);
      target.searchParams.set("state", options.stateOverride ?? q.get("state") ?? "");
      res.statusCode = 302;
      res.setHeader("location", target.toString());
      res.end();
      return;
    }
    const form = new URLSearchParams(await body(req));
    forms.push({ path: url.pathname, form });
    if (form.get("client_id") !== clientId) {
      json(res, 401, { error: "unauthorized_client", error_description: "unknown client" });
      return;
    }
    if (url.pathname === "/device/code" && options.device === true) {
      if (options.deviceCodeAnswer !== undefined) {
        json(res, options.deviceCodeAnswer.status, options.deviceCodeAnswer.body);
        return;
      }
      json(res, 200, {
        device_code: "device-code-1",
        user_code: USER_CODE,
        verification_uri: `${issuer}/activate`,
        verification_uri_complete: `${issuer}/activate?user_code=${USER_CODE}`,
        expires_in: 600,
        interval: 1,
      });
      return;
    }
    if (url.pathname !== "/token") {
      json(res, 404, { error: "not_found" });
      return;
    }
    switch (form.get("grant_type")) {
      case "authorization_code": {
        const pending = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (
          pending === undefined ||
          pending.redirectUri !== form.get("redirect_uri") ||
          createHash("sha256").update(verifier).digest("base64url") !== pending.challenge
        ) {
          json(res, 400, { error: "invalid_grant" });
          return;
        }
        codes.delete(form.get("code") ?? "");
        json(res, 200, tokens());
        return;
      }
      case "refresh_token":
        json(res, 200, tokens());
        return;
      case "urn:ietf:params:oauth:grant-type:device_code": {
        const answer = deviceAnswers.length > 1 ? deviceAnswers.shift() : deviceAnswers[0];
        if (answer === "approve") json(res, 200, tokens());
        else if (answer === "server_error") json(res, 500, { error: "server_error", error_description: "the tenant is down" });
        else if (answer === "not_json") {
          res.statusCode = 502;
          res.end("<html>bad gateway</html>");
        } else json(res, 400, { error: answer });
        return;
      }
      default:
        json(res, 400, { error: "unsupported_grant_type" });
    }
  };

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => json(res, 500, { error: String(err) }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    forms,
    authorizeRequests,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

function body(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(value));
}
