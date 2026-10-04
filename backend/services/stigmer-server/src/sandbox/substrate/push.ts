/**
 * The attach push: how the driver tells a sandbox which queue to serve
 * and hands it the runner's secrets, through Substrate's router.
 *
 * The contract is the runner's attach waiter (runner src/attach/push.ts
 * and waiter.ts): `POST /attach` with `{ taskQueue, secrets }`, routed by
 * the `ate-target-actor: <atespace>/<actor>` header to the actor's port
 * 80. The waiter accepts a queue only when the sandbox's own name is the
 * one derived from it, starts the runner on the first push, and on later
 * pushes only rotates the token the runner would restart with. Every
 * refusal carries a stable `code`, which the driver acts on; the `error`
 * text is for people.
 *
 * Retried: a connection failure and the router's 502, 503 and 504, which
 * mean the actor is still coming up (the router wakes and waits for an
 * actor on every request) or briefly unreachable, for up to 15 seconds.
 * Never retried: a refusal from the waiter itself, and a router whose
 * certificate this server does not accept (RouterTlsError), which is a
 * configuration fault and not a router still coming up. Neither the body
 * nor any secret is ever logged; only the code and the waiter's text.
 *
 * The transport (newRouterFetch) is a fetch-shaped function over
 * `node:http` and `node:https`, because the push carries secrets and
 * Node's global fetch takes no CA: Substrate's router serves HTTPS under
 * the cluster's own CA (its servicedns trust bundle, the one the Control
 * API's certificate also chains to). The CA file is read at boot and read
 * again whenever its mtime moves, because that CA is a refreshing pool on
 * Substrate's side and a CA read once would fail every wake after a
 * rotation. The server name defaults to the URL's host; in a cluster,
 * `https://atenet-router.ate-system.svc` matches the certificate's only
 * name, and a port-forward needs the override. Connections are kept
 * alive. One transport serves both schemes, so a push behaves the same
 * over http:// and https://, retries included.
 */

import { readFileSync, statSync } from "node:fs";
import * as http from "node:http";
import * as https from "node:https";
import type { Socket } from "node:net";

import type { SubstrateDriverSettings } from "./config.js";
import { delay } from "./delay.js";

const CA_FILE_VARIABLE = "STIGMER_SANDBOX_SUBSTRATE_ROUTER_CA_FILE";
const SERVER_NAME_VARIABLE = "STIGMER_SANDBOX_SUBSTRATE_ROUTER_SERVER_NAME";

/**
 * The router presented a certificate this server does not accept: the CA
 * or the server name is wrong. Thrown by the transport, rethrown by the
 * push at once.
 */
export class RouterTlsError extends Error {
  /** Node's verify code (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ERR_TLS_CERT_ALTNAME_INVALID`, ...). */
  readonly code: string;

  constructor(message: string, code: string, cause: unknown) {
    super(message, { cause });
    this.name = "RouterTlsError";
    this.code = code;
  }
}

/**
 * The codes Node gives a certificate it refuses: OpenSSL's verify results
 * and Node's own check of the name. Anything else (a refused connection, a
 * reset, a timeout) is a router that may still come up.
 */
const CERTIFICATE_REFUSALS: ReadonlySet<string> = new Set([
  "CERT_CHAIN_TOO_LONG",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "PATH_LENGTH_EXCEEDED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** Statuses whose reply carries no body, which a Response refuses one for. */
const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([204, 205, 304]);

/** The router's transport: what the push uses in place of the global fetch. */
export function newRouterFetch(
  settings: Pick<
    SubstrateDriverSettings,
    "routerUrl" | "routerCaFile" | "routerServerName"
  >,
): typeof fetch {
  const overTls = new URL(settings.routerUrl).protocol === "https:";
  if (!overTls) {
    for (const [variable, value] of [
      [CA_FILE_VARIABLE, settings.routerCaFile],
      [SERVER_NAME_VARIABLE, settings.routerServerName],
    ] as const) {
      if (value !== "") {
        throw new Error(
          `${variable} applies only to an https:// router; the router is ${settings.routerUrl}`,
        );
      }
    }
  }
  const caPem =
    settings.routerCaFile !== ""
      ? caFromFile(settings.routerCaFile)
      : undefined;
  const plainAgent = new http.Agent({ keepAlive: true });
  let secure: { agent: https.Agent; ca: string | undefined } | undefined;

  const secureAgent = (): https.Agent => {
    const ca = caPem?.();
    if (secure === undefined || secure.ca !== ca) {
      // Requests in flight finish on the agent they started on; its
      // connections, made under the old CA, are closed as each falls idle.
      if (secure !== undefined) retire(secure.agent);
      secure = {
        agent: new https.Agent({
          keepAlive: true,
          ...(ca !== undefined ? { ca } : {}),
        }),
        ca,
      };
    }
    return secure.agent;
  };

  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const tls = url.protocol === "https:";
    const body =
      request.body === null
        ? undefined
        : Buffer.from(await request.arrayBuffer());
    const headers: Record<string, string> = {};
    request.headers.forEach((value, name) => {
      headers[name] = value;
    });
    const serverName =
      settings.routerServerName !== ""
        ? settings.routerServerName
        : url.hostname;
    const options: https.RequestOptions = {
      method: request.method,
      headers,
      agent: tls ? secureAgent() : plainAgent,
      // Node sends the URL's host as the name unless it is an address; an
      // override is sent and checked in its place.
      ...(tls && settings.routerServerName !== ""
        ? { servername: settings.routerServerName }
        : {}),
    };
    const signal = request.signal;

    return new Promise<Response>((resolve, reject) => {
      const onAbort = (): void => {
        outgoing.destroy(
          signal.reason instanceof Error
            ? signal.reason
            : new Error("the push was aborted"),
        );
      };
      const fail = (error: unknown): void => {
        signal.removeEventListener("abort", onAbort);
        const code =
          error instanceof Error && "code" in error ? String(error.code) : "";
        if (tls && error instanceof Error && CERTIFICATE_REFUSALS.has(code)) {
          reject(
            new RouterTlsError(
              `the router at ${url.origin} presented a certificate this server does not accept (${code}: ${error.message}); it was checked against ${settings.routerCaFile !== "" ? `the CA in ${settings.routerCaFile}` : "the system roots"} (${CA_FILE_VARIABLE}) for the name ${serverName} (${SERVER_NAME_VARIABLE})`,
              code,
              error,
            ),
          );
          return;
        }
        reject(error);
      };
      const outgoing = (tls ? https : http).request(url, options, (reply) => {
        const chunks: Buffer[] = [];
        reply.on("data", (chunk: Buffer) => chunks.push(chunk));
        reply.on("error", fail);
        reply.on("end", () => {
          signal.removeEventListener("abort", onAbort);
          const status = reply.statusCode ?? 502;
          // The reply is relayed from inside a sandbox, so it is built
          // inside a catch: a status a Response cannot carry, or a header
          // it refuses, fails this push instead of throwing out of an
          // event listener and taking the server down.
          try {
            if (status < 200 || status > 599) {
              throw new Error(
                `the router answered status ${status}, which no reply carries`,
              );
            }
            const replyHeaders = new Headers();
            for (let i = 0; i + 1 < reply.rawHeaders.length; i += 2) {
              replyHeaders.append(
                reply.rawHeaders[i]!,
                reply.rawHeaders[i + 1]!,
              );
            }
            resolve(
              new Response(
                NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks),
                {
                  status,
                  statusText: reply.statusMessage ?? "",
                  headers: replyHeaders,
                },
              ),
            );
          } catch (error) {
            fail(error);
          }
        });
      });
      outgoing.on("error", fail);
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
      outgoing.end(body);
    });
  };
}

/**
 * The CA file's contents, read now (an unreadable file is a boot throw
 * naming the variable) and read again whenever its mtime moves. A read that
 * fails later is a failed push, retried like a router that is not up.
 */
function caFromFile(path: string): () => string {
  let cached: { mtimeMs: number; pem: string };
  const read = (): { mtimeMs: number; pem: string } => {
    const mtimeMs = statSync(path).mtimeMs;
    const pem = readFileSync(path, "utf8");
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error(`${path} holds no PEM certificate`);
    }
    return { mtimeMs, pem };
  };
  try {
    cached = read();
  } catch (error) {
    throw new Error(
      `${CA_FILE_VARIABLE} (${path}) cannot be used as the router's CA: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return () => {
    if (statSync(path).mtimeMs !== cached.mtimeMs) cached = read();
    return cached.pem;
  };
}

/**
 * Closes an agent's idle connections now, and each busy one as its
 * request finishes, so nothing trusted under a replaced CA stays open.
 */
function retire(agent: https.Agent): void {
  agent.on("free", (socket: Socket) => socket.destroy());
  for (const sockets of Object.values(agent.freeSockets)) {
    for (const socket of sockets ?? []) socket.destroy();
  }
}

/** What the waiter answered. */
export type PushResult =
  | { readonly ok: true; readonly started: boolean }
  | {
      readonly ok: false;
      readonly status: number;
      /** The waiter's refusal code; "" when the reply carried none. */
      readonly code: string;
      readonly error: string;
    };

export interface PushRequest {
  readonly routerUrl: string;
  readonly atespace: string;
  readonly actor: string;
  readonly taskQueue: string;
  readonly secrets: Readonly<Record<string, string>>;
}

/** How long the router may stay unready before a push fails. */
const RETRY_WINDOW_MS = 15_000;
const RETRY_DELAY_MS = 250;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export async function pushAttach(
  request: PushRequest,
  options: {
    readonly fetch?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
  } = {},
): Promise<PushResult> {
  const fetchImpl = options.fetch ?? fetch;
  const sleep = options.sleep ?? delay;
  const now = options.now ?? Date.now;
  const deadline = now() + RETRY_WINDOW_MS;
  const body = JSON.stringify({
    taskQueue: request.taskQueue,
    secrets: request.secrets,
  });

  for (;;) {
    let response: Response | undefined;
    let failure: string | undefined;
    try {
      response = await fetchImpl(`${request.routerUrl}/attach`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "ate-target-actor": `${request.atespace}/${request.actor}`,
        },
        body,
        signal: AbortSignal.timeout(RETRY_WINDOW_MS),
      });
    } catch (error) {
      if (error instanceof RouterTlsError) throw error;
      failure = error instanceof Error ? error.message : String(error);
    }
    if (response !== undefined && !RETRYABLE_STATUSES.has(response.status)) {
      return readReply(response);
    }
    if (now() >= deadline) {
      if (response !== undefined) return readReply(response);
      throw new Error(
        `the attach push to ${request.actor} could not reach the router: ${failure ?? "no reply"}`,
      );
    }
    await response?.body?.cancel();
    await sleep(RETRY_DELAY_MS);
  }
}

async function readReply(response: Response): Promise<PushResult> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const fields =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  if (response.status === 200) {
    return { ok: true, started: fields["started"] === true };
  }
  return {
    ok: false,
    status: response.status,
    code: typeof fields["code"] === "string" ? fields["code"] : "",
    error:
      typeof fields["error"] === "string"
        ? fields["error"]
        : text.slice(0, 200),
  };
}
