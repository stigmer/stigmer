/**
 * The runner artifact lane: the two routes a runner asks for short-lived
 * URLs on the artifact store's bucket, so a runner on any machine reads and
 * writes what a run stores beside its record without ever holding the
 * bucket's keys.
 *
 *   POST /v1/proxy/artifacts/presigned-upload-url    {key, content_type?} → {url, method, headers}
 *   POST /v1/proxy/artifacts/presigned-download-url  {key}                → {url}
 *
 * The wire is the runner's (`runner/src/shared/artifact-storage.ts`, its
 * `proxy` arm) and is pinned by the `proxy.artifact.*` conformance rows. A
 * request is evaluated in a fixed order: the path (404 for any but the
 * two), the method (405), the body (400), the key rules (400,
 * key-rules.ts), who may act on the run the key names (401 or 403,
 * authorize.ts), on an upload the content type (400), then the presign.
 * Every refusal has an empty body: the runner branches on the status alone
 * and retries 408, 429 and 5xx only, so an authorization backend that could
 * not answer is a 503, never a 403.
 *
 * Served only when the composed artifact store can presign a runner's
 * upload (`ArtifactStorage.presignRunnerUpload`); a server on the local
 * store has no such lane, and every `/v1/proxy/*` path but the model
 * registry stays a 404 there. The unified port routes the two paths to
 * the handler, and the composed server hands the same handler out
 * (`ComposedServer.runnerArtifactLane`) for an edition that serves
 * `/v1/proxy` on a listener of its own; the handler guards its own paths
 * because that listener's routing is not this module's to trust. An upload
 * URL is signed for the content type
 * and no length (the store's capability says why) and lives 30 minutes; a
 * download URL lives an hour. Both are signed for the address runners dial
 * the store at.
 *
 * The lane router is synchronous, so each request runs detached with a
 * terminal catch, and writes one log line on an answer it gives: the
 * route, the status, the key and who was admitted, never a credential or a
 * URL (a URL is a credential for its lifetime).
 *
 * Proven by __tests__/lane.test.ts and the `bucket` profile of
 * test/install/smoke-operator.mjs.
 */
import type { Readable } from "node:stream";

import type { Logger } from "../../boot/logger.js";
import { parseBearerToken } from "../../pipeline/interceptors/auth.js";
import {
  RUNNER_ARTIFACT_DOWNLOAD_PATH,
  RUNNER_ARTIFACT_UPLOAD_PATH,
} from "../../transport/constants.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../../transport/lanes.js";
import type { ArtifactStorage, PresignedRunnerUpload } from "../artifact-storage.js";
import { decideArtifactAccess, type RunnerArtifactAccessDeps } from "./authorize.js";
import {
  ARTIFACT_DEFAULT_CONTENT_TYPE,
  artifactKeyProblem,
  isValidMimeType,
  runIdFromArtifactKey,
} from "./key-rules.js";

/** How long an upload URL lives: the longest runner upload seen, with margin. */
export const RUNNER_UPLOAD_URL_TTL_MS = 30 * 60 * 1000;

/** How long a download URL lives. */
export const RUNNER_DOWNLOAD_URL_TTL_MS = 60 * 60 * 1000;

/**
 * The largest body the lane reads. A body is a key (at most 1024
 * characters) and a content type; the bytes themselves go to the bucket on
 * the URL, never through the server.
 */
export const RUNNER_LANE_BODY_MAX_BYTES = 64 * 1024;

/** The store's two calls the lane makes: a runner's upload URL and a runner's download URL. */
export type RunnerLaneStore = Required<Pick<ArtifactStorage, "presignRunnerUpload">> &
  Pick<ArtifactStorage, "getSignedUrl">;

export interface RunnerArtifactLaneOptions extends RunnerArtifactAccessDeps {
  readonly storage: RunnerLaneStore;
}

/** Whether a composed store can serve the lane. */
export function servesRunnerLane(storage: ArtifactStorage): storage is ArtifactStorage & RunnerLaneStore {
  return typeof storage.presignRunnerUpload === "function";
}

/** Whether the unified port routes `path` to this lane. */
export function isRunnerArtifactPath(path: string): boolean {
  return path === RUNNER_ARTIFACT_UPLOAD_PATH || path === RUNNER_ARTIFACT_DOWNLOAD_PATH;
}

/** A refusal or an answer: the status, and a JSON body for a 200 only. */
type Answer =
  | { readonly status: 200; readonly body: PresignedRunnerUpload | { readonly url: string } }
  | { readonly status: 400 | 401 | 403 | 404 | 405 | 413 | 503; readonly reason: string };

export function createRunnerArtifactLane(options: RunnerArtifactLaneOptions): LaneHandler {
  return (request: LaneRequest, response: LaneResponse): void => {
    const path = (request.url ?? "").split("?", 1)[0] ?? "";
    void serve(options, request, path)
      .then((answer) => write(options.logger, response, path, answer))
      .catch((error: unknown) => {
        options.logger.error("runner artifact lane failed", {
          route: path,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!response.headersSent) {
          response.statusCode = 500;
          response.end();
        }
      });
  };
}

async function serve(
  options: RunnerArtifactLaneOptions,
  request: LaneRequest,
  path: string,
): Promise<Answer & { readonly key?: string; readonly by?: string }> {
  if (!isRunnerArtifactPath(path)) {
    return { status: 404, reason: "not a runner artifact path" };
  }
  const upload = path === RUNNER_ARTIFACT_UPLOAD_PATH;
  if (request.method !== "POST") {
    return { status: 405, reason: "method" };
  }
  const read = await readBody(request);
  if (read === "too-large") {
    return { status: 413, reason: "body exceeds the lane's cap" };
  }
  const body = parseObject(read);
  if (body === undefined) {
    return { status: 400, reason: "body is not a JSON object" };
  }
  const key = typeof body.key === "string" ? body.key : undefined;
  const problem = artifactKeyProblem(key);
  if (problem !== undefined || key === undefined) {
    return { status: 400, reason: problem ?? "key is required" };
  }
  const runId = runIdFromArtifactKey(key);
  if (runId === undefined) {
    return { status: 403, reason: "key names no run", key };
  }
  const token = parseBearerToken(headerOf(request, "authorization") ?? "");
  const access = await decideArtifactAccess(options, token, runId, upload);
  switch (access.kind) {
    case "unauthenticated":
      return { status: 401, reason: "no credential the server recognizes", key };
    case "deny":
      return { status: 403, reason: "not permitted on the key's run", key };
    case "unavailable":
      return { status: 503, reason: `authorization unavailable: ${access.cause}`, key };
    case "allow":
      break;
    /* v8 ignore next 4 -- @preserve: the compile-time exhaustiveness check; decideArtifactAccess returns only the four kinds above */
    default: {
      const exhaustive: never = access;
      throw new Error(`unknown access decision ${String(exhaustive)}`);
    }
  }
  if (upload) {
    const contentType =
      typeof body.content_type === "string" ? body.content_type : ARTIFACT_DEFAULT_CONTENT_TYPE;
    if (!isValidMimeType(contentType)) {
      return { status: 400, reason: "content_type is not a MIME type", key };
    }
    const presigned = await options.storage.presignRunnerUpload(key, contentType, RUNNER_UPLOAD_URL_TTL_MS);
    return { status: 200, body: presigned, key, by: access.by };
  }
  const url = await options.storage.getSignedUrl(key, RUNNER_DOWNLOAD_URL_TTL_MS, "", "runner");
  return { status: 200, body: { url }, key, by: access.by };
}

function write(
  logger: Logger,
  response: LaneResponse,
  route: string,
  answer: Answer & { readonly key?: string; readonly by?: string },
): void {
  const fields = {
    route,
    status: answer.status,
    ...(answer.key === undefined ? {} : { key: answer.key }),
    ...(answer.by === undefined ? {} : { by: answer.by }),
  };
  if (answer.status === 200) {
    logger.info("runner artifact URL issued", fields);
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(answer.body));
    return;
  }
  (answer.status === 503 ? logger.warn.bind(logger) : logger.info.bind(logger))(
    "runner artifact URL refused",
    { ...fields, reason: answer.reason },
  );
  response.statusCode = answer.status;
  if (answer.status === 401) {
    response.setHeader("www-authenticate", "Bearer");
  }
  if (answer.status === 405) {
    response.setHeader("allow", "POST");
  }
  response.end();
}

/**
 * The body, read up to the cap. Past the cap the rest is left unread (Node
 * drains it once the answer is written), so the client reads the 413
 * instead of a broken connection.
 */
async function readBody(request: LaneRequest): Promise<Buffer | "too-large"> {
  if (Number(headerOf(request, "content-length") ?? 0) > RUNNER_LANE_BODY_MAX_BYTES) {
    return "too-large";
  }
  const body: Readable = request;
  return new Promise<Buffer | "too-large">((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > RUNNER_LANE_BODY_MAX_BYTES) {
        body.off("data", onData);
        resolve("too-large");
        return;
      }
      chunks.push(chunk);
    };
    body.on("data", onData);
    body.once("end", () => resolve(Buffer.concat(chunks)));
    body.once("error", reject);
    body.once("close", () => reject(new Error("the client closed the request before its body ended")));
  });
}

function parseObject(raw: Buffer): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function headerOf(request: LaneRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : value;
}
