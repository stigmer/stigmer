/**
 * Pins the runner artifact lane's HTTP edge (lane.ts, key-rules.ts) on a
 * real listener, with the access decision and the store faked:
 *
 *   - the order of evaluation: a body that is not a JSON object, then each
 *     key rule in order, each a 400 before anyone is asked; a key naming no
 *     run is a 403; then the access decision (401 with `WWW-Authenticate`,
 *     403, or 503 for an authorization that could not answer); then, on an
 *     upload, the content type (400);
 *   - an upload answers `{url, method, headers}` signed for the declared
 *     content type (the default when none is declared), a download `{url}`
 *     signed for the runner's address;
 *   - every refusal has an empty body; a body over the cap is a 413,
 *     whether its length is declared or only counted as it streams; a
 *     method other than POST is a 405 with `Allow`;
 *   - a store that fails as it presigns is an empty 500, logged with the
 *     route and the cause, never a URL;
 *   - the run a key names is read only from a key under `artifacts/`;
 *   - a store without the runner upload capability serves no lane.
 */
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import type { ArtifactStorage } from "../../artifact-storage.js";
import type { IdentityVerifier } from "../../../extensions/identity.js";
import { runIdFromArtifactKey } from "../key-rules.js";
import {
  createRunnerArtifactLane,
  isRunnerArtifactPath,
  RUNNER_LANE_BODY_MAX_BYTES,
  servesRunnerLane,
  type RunnerLaneStore,
} from "../lane.js";

/** The lane's error lines, as written. */
const errors: string[] = [];
const logger = createLogger({ level: "error", pretty: false, write: (line) => errors.push(line) });

/** A key whose presign the fake store fails, as a bucket that cannot be reached would. */
const FAULTING_KEY = "artifacts/run_1/unreachable";

const presigned: Array<{ key: string; contentType?: string; reader?: string }> = [];
const storage: RunnerLaneStore = {
  presignRunnerUpload(key, contentType) {
    if (key === FAULTING_KEY) {
      return Promise.reject(new Error("bucket unreachable"));
    }
    presigned.push({ key, contentType });
    return Promise.resolve({ url: `https://bucket.test/${key}?put`, method: "PUT", headers: { "content-type": contentType } });
  },
  getSignedUrl(key, _ttl, _filename, reader) {
    presigned.push({ key, reader });
    return Promise.resolve(`https://bucket.test/${key}?get`);
  },
};

let server: Server;
let base = "";

beforeAll(async () => {
  // The decision itself is authorize.test.ts's; here each credential names
  // its answer: `runner` is a runner credential, `outsider` an identity the
  // authorizer refuses, `outage` one it cannot answer for.
  const lane = createRunnerArtifactLane({
    logger,
    storage,
    store: undefined as never,
    runnerAuth: {
      verify: () => {
        throw new Error("unused");
      },
      authorizeRunnerForRun: (token) => Promise.resolve(token === "runner"),
    },
    identityVerifiers: [
      {
        name: "test",
        verify: (token: string) =>
          Promise.resolve(
            token === "outsider" || token === "outage"
              ? { identityId: token, callerClass: "user", issuer: "test", rawToken: token }
              : null,
          ),
      } as IdentityVerifier,
    ],
    authorizer: {
      authorize: (caller) =>
        Promise.resolve(
          caller.identityId === "outage"
            ? { kind: "unavailable", cause: new Error("authorizer down") }
            : { kind: "deny", reason: "not a member" },
        ),
    },
  });
  server = createServer(lane);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function post(path: string, body: string, token = "runner"): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === "" ? {} : { authorization: `Bearer ${token}` }) },
    body,
  });
  return { status: response.status, text: await response.text(), headers: response.headers };
}

const UPLOAD = "/v1/proxy/artifacts/presigned-upload-url";
const DOWNLOAD = "/v1/proxy/artifacts/presigned-download-url";

describe("the runner artifact lane", () => {
  it("routes exactly its two paths", () => {
    expect(isRunnerArtifactPath(UPLOAD)).toBe(true);
    expect(isRunnerArtifactPath(DOWNLOAD)).toBe(true);
    expect(isRunnerArtifactPath("/v1/proxy/artifacts")).toBe(false);
    expect(isRunnerArtifactPath("/v1/proxy/artifacts/presigned-upload-url/x")).toBe(false);
  });

  it("issues an upload URL with the declared type signed, the default when none is declared", async () => {
    const declared = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/out.txt", content_type: "text/plain" }));
    expect(declared.status).toBe(200);
    expect(JSON.parse(declared.text)).toEqual({
      url: "https://bucket.test/artifacts/run_1/out.txt?put",
      method: "PUT",
      headers: { "content-type": "text/plain" },
    });
    const undeclared = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/blob" }));
    expect(JSON.parse(undeclared.text).headers).toEqual({ "content-type": "application/octet-stream" });
  });

  it("issues a download URL signed for the runner's address", async () => {
    const answer = await post(DOWNLOAD, JSON.stringify({ key: "artifacts/run_1/out.txt" }));
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.text)).toEqual({ url: "https://bucket.test/artifacts/run_1/out.txt?get" });
    expect(presigned.at(-1)).toEqual({ key: "artifacts/run_1/out.txt", reader: "runner" });
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[]"],
    ["no key", "{}"],
    ["a blank key", JSON.stringify({ key: " " })],
    ["a key over the cap", JSON.stringify({ key: `artifacts/run_1/${"a".repeat(1100)}` })],
    ["a space", JSON.stringify({ key: "artifacts/run_1/a b" })],
    ["a traversal", JSON.stringify({ key: "artifacts/run_1/../run_2/x" })],
    ["a doubled slash", JSON.stringify({ key: "artifacts//run_1/x" })],
    ["a foreign prefix", JSON.stringify({ key: "attachments/run_1/x" })],
  ])("refuses %s with an empty 400, before anyone is asked", async (_name, body) => {
    // An outsider's credential: had anyone been asked, the answer would be 403.
    const answer = await post(UPLOAD, body, "outsider");
    expect(answer.status).toBe(400);
    expect(answer.text).toBe("");
  });

  it("refuses a key that names no run with an empty 403", async () => {
    const answer = await post(DOWNLOAD, JSON.stringify({ key: "artifacts/run_1" }));
    expect(answer.status).toBe(403);
    expect(answer.text).toBe("");
  });

  it("refuses a caller the authorizer refuses with an empty 403, and one it cannot answer for with 503", async () => {
    const refused = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/x" }), "outsider");
    expect(refused.status).toBe(403);
    expect(refused.text).toBe("");
    const outage = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/x" }), "outage");
    expect(outage.status).toBe(503);
    expect(outage.text).toBe("");
  });

  it("refuses a missing or unrecognized credential with 401 and the bearer challenge", async () => {
    const unknown = await post(DOWNLOAD, JSON.stringify({ key: "artifacts/run_1/x" }), "stranger");
    expect(unknown.status).toBe(401);
    const answer = await post(DOWNLOAD, JSON.stringify({ key: "artifacts/run_1/x" }), "");
    expect(answer.status).toBe(401);
    expect(answer.headers.get("www-authenticate")).toBe("Bearer");
    expect(answer.text).toBe("");
  });

  it("checks the content type only after access, refusing a malformed one with an empty 400", async () => {
    const answer = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/x", content_type: "not a type" }));
    expect(answer.status).toBe(400);
    expect(answer.text).toBe("");
  });

  it("refuses a body over the cap with 413 and another method with 405", async () => {
    const big = await post(UPLOAD, JSON.stringify({ key: "artifacts/run_1/x", pad: "a".repeat(RUNNER_LANE_BODY_MAX_BYTES) }));
    expect(big.status).toBe(413);
    const get = await fetch(`${base}${UPLOAD}`, { headers: { authorization: "Bearer runner" } });
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("counts a streamed body with no declared length against the cap, a 413", async () => {
    const answer = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const sent = request(
        `${base}${UPLOAD}`,
        { method: "POST", agent: false, headers: { authorization: "Bearer runner", "content-type": "application/json" } },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            body += chunk;
          });
          response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
        },
      );
      sent.on("error", reject);
      // Two writes and no Content-Length: the body goes chunked, so only
      // counting it as it arrives can find it over the cap.
      const half = Buffer.alloc(RUNNER_LANE_BODY_MAX_BYTES / 2 + 1, "a");
      sent.write(half);
      sent.write(half);
      sent.end();
    });
    expect(answer).toEqual({ status: 413, body: "" });
  });

  it("answers a store that fails as it presigns with an empty 500, logging the route and the cause", async () => {
    errors.length = 0;
    const answer = await post(UPLOAD, JSON.stringify({ key: FAULTING_KEY }));
    expect(answer.status).toBe(500);
    expect(answer.text).toBe("");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("runner artifact lane failed");
    expect(errors[0]).toContain(UPLOAD);
    expect(errors[0]).toContain("bucket unreachable");
  });

  it("reads the run only from a key under artifacts/", () => {
    expect(runIdFromArtifactKey("artifacts/run_1/out.txt")).toBe("run_1");
    expect(runIdFromArtifactKey("attachments/run_1/out.txt")).toBeUndefined();
    expect(runIdFromArtifactKey("artifacts/run_1/")).toBeUndefined();
  });

  it("is served only by a store that can presign a runner's upload", () => {
    const local = { getSignedUrl: storage.getSignedUrl } as unknown as ArtifactStorage;
    expect(servesRunnerLane(local)).toBe(false);
    expect(servesRunnerLane(storage as unknown as ArtifactStorage)).toBe(true);
  });
});
