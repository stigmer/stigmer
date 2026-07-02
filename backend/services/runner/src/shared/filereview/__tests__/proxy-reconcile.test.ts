/**
 * @regression file-hitl-proxy-reconcile — the file-review reconcile crash in
 * cloud/desktop (proxy) artifact mode (see _cursor/error.md: an ExecuteCursor
 * turn died on `Artifact download failed (HTTP 404) ... NoSuchKey` for a CAS
 * manifest a git-only turn never wrote).
 *
 * This exercises the REAL {@link ProxyArtifactStorage} end to end against a mock
 * proxy + object store, so the whole stack — presign, the ranged-GET existence
 * probe, blob upload/download, and the manifest reconcile — is proven over HTTP.
 * That is precisely the coverage that was missing when the bug shipped: every
 * prior file-review proof used LocalArtifactStorage / in-memory fakes, whose
 * `exists()` is honest, so none of them could reproduce the proxy behavior where
 * a presigned URL is minted for a key that does not exist.
 */

import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clone, create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  FileDecisionSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type { CapturedFileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileCaptureClass,
  FileDecisionAction,
  FileDecisionScope,
  FileChangeSetStatus,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ProxyArtifactStorage } from "../../artifact-storage.js";
import { casBlobReader, casManifestKey } from "../cas-substrate.js";
import {
  applyCaptureDecisions,
  captureBaselineToLedger,
  captureCandidateToLedger,
} from "../capture.js";

const execFileAsync = promisify(execFile);
const EXEC_ID = "exec-proxy-1";
const CHANGE_SET_ID = `${EXEC_ID}:0`;
const HARNESS = "cursor";

// ─── Mock proxy + object store (faithful to ProxyArtifactStorage's contract) ──

interface MockProxy {
  readonly endpoint: string;
  /** The object store (R2 stand-in), keyed by artifact key. */
  readonly objects: Map<string, Buffer>;
  /** Every object key that was GET (download or existence-probe). */
  readonly objectGets: string[];
  close(): Promise<void>;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function startMockProxy(): Promise<MockProxy> {
  const objects = new Map<string, Buffer>();
  const objectGets: string[] = [];

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // Presign endpoints mint a URL for ANY key — the real proxy does NOT verify
    // the object exists. This is exactly the property exists() must not trust.
    if (req.method === "POST" && url.pathname.endsWith("/presigned-upload-url")) {
      const { key } = JSON.parse((await readBody(req)).toString()) as { key: string };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: `${base}/obj/${encodeURIComponent(key)}`, headers: {} }));
      return;
    }
    if (req.method === "POST" && url.pathname.endsWith("/presigned-download-url")) {
      const { key } = JSON.parse((await readBody(req)).toString()) as { key: string };
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: `${base}/obj/${encodeURIComponent(key)}` }));
      return;
    }

    if (url.pathname.startsWith("/obj/")) {
      const key = decodeURIComponent(url.pathname.slice("/obj/".length));
      if (req.method === "PUT") {
        objects.set(key, await readBody(req));
        res.writeHead(200);
        res.end();
        return;
      }
      if (req.method === "GET") {
        objectGets.push(key);
        const buf = objects.get(key);
        if (!buf) {
          res.writeHead(404);
          res.end("<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code></Error>");
          return;
        }
        const range = req.headers["range"];
        if (typeof range === "string" && range.startsWith("bytes=")) {
          if (buf.length === 0) {
            res.writeHead(416); // empty object: range unsatisfiable, yet it exists
            res.end();
            return;
          }
          res.writeHead(206, { "content-range": `bytes 0-0/${buf.length}` });
          res.end(buf.subarray(0, 1));
          return;
        }
        res.writeHead(200);
        res.end(buf);
        return;
      }
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    endpoint,
    objects,
    objectGets,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ─── Change-set helpers (mirror the server projection: DECIDED set + snapshot) ─

function eventsOfType(status: AgentExecutionStatus, type: FileReviewEventType) {
  return (status.fileReviewEventStream?.events ?? []).filter((e) => e.eventType === type);
}
function candidateChanges(status: AgentExecutionStatus): CapturedFileChange[] {
  const ev = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  return ev?.payload.case === "candidateCaptured" ? ev.payload.value.changes : [];
}
function decidedChangeSet(
  status: AgentExecutionStatus,
  decisionByPath: Record<string, FileDecisionAction>,
) {
  const changes = candidateChanges(status).map((c) => clone(CapturedFileChangeSchema, c));
  const decisions = changes
    .filter((c) => decisionByPath[c.pathAfter || c.pathBefore] !== undefined)
    .map((c) =>
      create(FileDecisionSchema, {
        id: `${c.id}:d`,
        changeSetId: CHANGE_SET_ID,
        scope: FileDecisionScope.FILE,
        fileChangeId: c.id,
        action: decisionByPath[c.pathAfter || c.pathBefore],
        expectedDigest: c.fileDigest,
      }),
    );
  const candEv = eventsOfType(status, FileReviewEventType.CANDIDATE_CAPTURED)[0];
  const candidateSnapshot =
    candEv?.payload.case === "candidateCaptured" ? candEv.payload.value.candidateSnapshot : undefined;
  return create(FileChangeSetSchema, {
    id: CHANGE_SET_ID,
    changes,
    decisions,
    candidateSnapshot,
    status: FileChangeSetStatus.DECIDED,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("proxy-mode file-review reconcile (real ProxyArtifactStorage)", () => {
  let proxy: MockProxy;
  let storage: ProxyArtifactStorage;

  beforeEach(async () => {
    proxy = await startMockProxy();
    storage = new ProxyArtifactStorage(proxy.endpoint, "tok");
  });
  afterEach(async () => {
    await proxy.close();
  });

  it("git-only turn reconciles without probing/downloading a nonexistent CAS manifest (error.md regression)", async () => {
    const repo = await mkdtemp(join(tmpdir(), "stigmer-proxy-git-"));
    try {
      const git = (args: string[]) => execFileAsync("git", args, { cwd: repo });
      await git(["init", "-q"]);
      await git(["config", "user.email", "t@t.local"]);
      await git(["config", "user.name", "t"]);
      await writeFile(join(repo, "notes.md"), "planton notes\n");
      await git(["add", "-A"]);
      await git(["commit", "-q", "-m", "initial"]);

      const status = create(AgentExecutionStatusSchema, {});
      const baseline = await captureBaselineToLedger({
        status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID, harnessId: HARNESS,
      });
      await writeFile(join(repo, "notes.md"), "PLANTON notes edited\n");
      await captureCandidateToLedger({
        status, gitRoot: repo, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
        baselineTree: baseline, harnessId: HARNESS,
      });

      const changeSet = decidedChangeSet(status, { "notes.md": FileDecisionAction.APPROVE });

      // The exact production call shape: a real ProxyArtifactStorage is threaded.
      const result = await applyCaptureDecisions({
        status, gitRoot: repo, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
        storage, readBlob: casBlobReader(storage),
      });

      expect(result.failed).toBe(false);
      expect(result.approvedPaths).toEqual(["notes.md"]);
      expect(await readFile(join(repo, "notes.md"), "utf8")).toBe("PLANTON notes edited\n");
      // The regression proof: the reconcile never fetched the (nonexistent) CAS
      // manifest from the object store. On the old code, exists() trusted the
      // presign, this GET returned 404, and the execution crashed.
      expect(proxy.objectGets).not.toContain(casManifestKey(EXEC_ID, CHANGE_SET_ID));
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("non-git CAS turn round-trips blobs + manifest through the real proxy (approve byte-exact, reject reverted)", async () => {
    const ws = await mkdtemp(join(tmpdir(), "stigmer-proxy-cas-"));
    try {
      const enc = (s: string) => new TextEncoder().encode(s);
      const status = create(AgentExecutionStatusSchema, {});
      const baseline = await captureBaselineToLedger({
        status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
        harnessId: HARNESS, gitWorkspace: false,
      });

      // The turn's edits are already on disk (the "after" state under review).
      await writeFile(join(ws, "created.txt"), "X");
      await writeFile(join(ws, "edited.txt"), "NEW");
      await captureCandidateToLedger({
        status, gitRoot: ws, executionId: EXEC_ID, changeSetId: CHANGE_SET_ID,
        baselineTree: baseline, harnessId: HARNESS, gitWorkspace: false, storage,
        casCaptures: [
          { path: "created.txt", before: null, after: enc("X"), captureClass: FileCaptureClass.NON_GIT_CAS },
          { path: "edited.txt", before: enc("OLD"), after: enc("NEW"), captureClass: FileCaptureClass.NON_GIT_CAS },
        ],
      });

      // Blobs + manifest were uploaded THROUGH THE REAL PROXY. The dedup check
      // (exists() -> object GET 404 -> PUT) is what the broken exists() defeated:
      // it reported "already present" and skipped every upload.
      expect(proxy.objects.has(casManifestKey(EXEC_ID, CHANGE_SET_ID))).toBe(true);
      // 2 after-blobs ("X", "NEW") + 1 before-blob ("OLD") + 1 manifest.
      expect(proxy.objects.size).toBe(4);

      const changeSet = decidedChangeSet(status, {
        "created.txt": FileDecisionAction.APPROVE,
        "edited.txt": FileDecisionAction.REJECT,
      });
      const result = await applyCaptureDecisions({
        status, gitRoot: ws, executionId: EXEC_ID, changeSet, harnessId: HARNESS,
        storage, readBlob: casBlobReader(storage), gitWorkspace: false,
      });

      expect(result.failed).toBe(false);
      // Approved create kept byte-exact from the downloaded after-blob.
      expect(await readFile(join(ws, "created.txt"), "utf8")).toBe("X");
      // Rejected modify snapped back to its downloaded before-blob.
      expect(await readFile(join(ws, "edited.txt"), "utf8")).toBe("OLD");
      // The manifest WAS downloaded this time (a genuine CAS turn), unlike the
      // git-only case above.
      expect(proxy.objectGets).toContain(casManifestKey(EXEC_ID, CHANGE_SET_ID));
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
});
