/**
 * Attachment + artifact RPC tests — ports upload_attachment_test.go,
 * get_artifact_content_test.go, and get_artifact_download_url_test.go
 * case-for-case over a real SQLite store and a real local-filesystem
 * artifact backend (the same direct-call shape as Go's controller tests).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  GetArtifactContentRequestSchema,
  GetArtifactDownloadUrlRequestSchema,
  UploadAttachmentRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LocalArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import type { ArtifactRpcDeps } from "../artifacts.js";
import {
  detectContentType,
  getArtifactContent,
  getArtifactDownloadUrl,
  uploadAttachment,
} from "../artifacts.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;
let deps: ArtifactRpcDeps;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "aexec-artifacts-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  deps = {
    store,
    logger: silentLogger,
    artifactStorage: new LocalArtifactStorage(
      path.join(dir, "artifacts"),
      "http://localhost:7235",
    ),
  };
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function seedExecution(
  executionId: string,
  attachmentKey?: string,
): Promise<void> {
  await store.saveResource(
    ApiResourceKind.agent_execution,
    executionId,
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      metadata: { id: executionId, name: "artifact-test" },
      spec:
        attachmentKey === undefined
          ? {}
          : {
              attachments: [
                {
                  filename: "notes.png",
                  storageKey: attachmentKey,
                  contentType: "image/png",
                },
              ],
            },
    }),
  );
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// The exact CAS blob key shape the runner writes: when the stored bytes
// differ from content, the key's embedded address no longer matches the
// served bytes (the tamper case).
function casBlobKeyFor(executionId: string, content: Uint8Array): string {
  return `artifacts/${executionId}/filereview/cas/blobs/${sha256Hex(content)}`;
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(code);
    return connectError;
  }
  throw new Error(`expected code ${Code[code]}, call succeeded`);
}

describe("uploadAttachment", () => {
  // The service boundary refuses a filename that would smuggle path
  // separators or `..` segments into the storage key — backstopping the
  // buf.validate constraint so a bypassed constraint still fails closed.
  const badFilenames = [
    "../evil.txt",
    "../../evil.txt",
    "a/b.txt",
    "dir/../../escape",
    "..",
    ".",
    "..\\evil.txt",
    "sub\\file.txt",
  ];
  for (const name of badFilenames) {
    it(`rejects traversal filename ${JSON.stringify(name)}`, async () => {
      await expectCode(
        () =>
          uploadAttachment(
            deps,
            create(UploadAttachmentRequestSchema, {
              filename: name,
              content: Buffer.from("payload"),
            }),
          ),
        Code.InvalidArgument,
      );
    });
  }

  // The guard must not over-reject: ordinary filenames (dots inside the
  // name, spaces, unicode) upload and produce the documented key shape.
  const goodFilenames = [
    "dataset.csv",
    "report.final.v2.pdf",
    "my report.txt",
    "contrat-français.pdf",
  ];
  for (const name of goodFilenames) {
    it(`accepts plain filename ${JSON.stringify(name)}`, async () => {
      const resp = await uploadAttachment(
        deps,
        create(UploadAttachmentRequestSchema, {
          filename: name,
          content: Buffer.from("payload"),
        }),
      );
      expect(resp.storageKey.startsWith("attachments/")).toBe(true);
      expect(resp.storageKey.endsWith(`/${name}`)).toBe(true);
    });
  }

  it("rejects empty filename and empty content", async () => {
    await expectCode(
      () =>
        uploadAttachment(
          deps,
          create(UploadAttachmentRequestSchema, {
            filename: "",
            content: Buffer.from("x"),
          }),
        ),
      Code.InvalidArgument,
    );
    await expectCode(
      () =>
        uploadAttachment(
          deps,
          create(UploadAttachmentRequestSchema, {
            filename: "ok.txt",
            content: new Uint8Array(),
          }),
        ),
      Code.InvalidArgument,
    );
  });
});

describe("getArtifactContent CAS blob integrity", () => {
  const execId = "aex_artifact";

  async function upload(key: string, data: Uint8Array): Promise<void> {
    await deps.artifactStorage.upload(key, data, "application/octet-stream");
  }

  it("matching CAS blob is served", async () => {
    await seedExecution(execId);
    const body = Buffer.from("gitignored file bytes");
    const key = casBlobKeyFor(execId, body);
    await upload(key, body);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: key,
      }),
    );
    expect(Buffer.from(resp.content).toString()).toBe(
      "gitignored file bytes",
    );
    expect(resp.contentType).toBe("application/octet-stream");
  });

  it("tampered CAS blob fails closed with DATA_LOSS", async () => {
    await seedExecution(execId);
    // Key addresses the hash of the original bytes; store different bytes.
    const key = casBlobKeyFor(
      execId,
      Buffer.from("original bytes the runner captured"),
    );
    await upload(key, Buffer.from("corrupted bytes"));

    await expectCode(
      () =>
        getArtifactContent(
          deps,
          create(GetArtifactContentRequestSchema, {
            executionId: execId,
            storageKey: key,
          }),
        ),
      Code.DataLoss,
    );
  });

  it("CAS blob key of another execution is rejected", async () => {
    await seedExecution(execId);
    const otherKey = casBlobKeyFor("aex_someone_else", Buffer.from("x"));
    await expectCode(
      () =>
        getArtifactContent(
          deps,
          create(GetArtifactContentRequestSchema, {
            executionId: execId,
            storageKey: otherKey,
          }),
        ),
      Code.InvalidArgument,
    );
  });

  it("manifest is served unverified", async () => {
    await seedExecution(execId);
    const manifestKey = `artifacts/${execId}/filereview/cas/${execId}_0.manifest.json`;
    const manifest = Buffer.from(
      `{"changeSetId":"${execId}:0","files":[]}`,
    );
    await upload(manifestKey, manifest);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: manifestKey,
      }),
    );
    expect(Buffer.from(resp.content).toString()).toBe(manifest.toString());
    expect(resp.contentType).toBe("application/json");
  });

  it("blob exactly at max_bytes is verified", async () => {
    await seedExecution(execId);
    const body = Buffer.from("0123456789");
    const key = casBlobKeyFor(execId, body);
    await upload(key, body);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: key,
        maxBytes: BigInt(body.length),
      }),
    );
    expect(resp.truncated).toBe(false);
  });

  it("truncated read skips verification (no false DATA_LOSS)", async () => {
    await seedExecution(execId);
    // A tampered blob larger than max_bytes: the partial read cannot
    // full-hash-verify, so it must be served (truncated), not rejected.
    const key = casBlobKeyFor(
      execId,
      Buffer.from("the original object bytes"),
    );
    const stored = Buffer.from(
      "corrupted but served because the read is truncated",
    );
    await upload(key, stored);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: key,
        maxBytes: BigInt(stored.length - 1),
      }),
    );
    expect(resp.truncated).toBe(true);
  });

  it("max_bytes <= 0 falls back to the 512KB default (fail-safe)", async () => {
    await seedExecution(execId);
    const body = Buffer.from("small body");
    const key = casBlobKeyFor(execId, body);
    await upload(key, body);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: key,
        maxBytes: BigInt(-1),
      }),
    );
    // The default (512KB) applies, so the whole small object is served.
    expect(resp.truncated).toBe(false);
    expect(Buffer.from(resp.content).toString()).toBe("small body");
  });

  it("unknown execution answers NotFound", async () => {
    await expectCode(
      () =>
        getArtifactContent(
          deps,
          create(GetArtifactContentRequestSchema, {
            executionId: "aex_never_seeded",
            storageKey: "artifacts/aex_never_seeded/out.txt",
          }),
        ),
      Code.NotFound,
    );
  });

  it("extracts a single entry from a ZIP artifact with entry-derived content type", async () => {
    await seedExecution(execId);
    const zipped = zipSync({
      "report/summary.md": Buffer.from("# Summary"),
      "report/data.csv": Buffer.from("a,b\n1,2"),
    });
    const key = `artifacts/${execId}/report.zip`;
    await upload(key, zipped);

    const resp = await getArtifactContent(
      deps,
      create(GetArtifactContentRequestSchema, {
        executionId: execId,
        storageKey: key,
        entryPath: "report/summary.md",
      }),
    );
    expect(Buffer.from(resp.content).toString()).toBe("# Summary");
    expect(resp.contentType).toBe("text/markdown");

    await expectCode(
      () =>
        getArtifactContent(
          deps,
          create(GetArtifactContentRequestSchema, {
            executionId: execId,
            storageKey: key,
            entryPath: "missing/entry.txt",
          }),
        ),
      Code.NotFound,
    );
  });
});

describe("getArtifactDownloadUrl", () => {
  const execId = "aex_download";
  const key = `artifacts/${execId}/plan_card_ux_cleanup.plan.md`;

  it("inline by default (no disposition)", async () => {
    await seedExecution(execId);
    const resp = await getArtifactDownloadUrl(
      deps,
      create(GetArtifactDownloadUrlRequestSchema, {
        executionId: execId,
        storageKey: key,
      }),
    );
    expect(resp.downloadUrl).not.toContain("download=");
    expect(resp.expiresAt).not.toBe("");
  });

  it("as_attachment names the download after the artifact", async () => {
    await seedExecution(execId);
    const resp = await getArtifactDownloadUrl(
      deps,
      create(GetArtifactDownloadUrlRequestSchema, {
        executionId: execId,
        storageKey: key,
        asAttachment: true,
      }),
    );
    expect(resp.downloadUrl).toContain(
      "download=plan_card_ux_cleanup.plan.md",
    );
  });

  describe("spec.attachments key arm", () => {
    const attachExecId = "aex_attach_presign";
    const attachmentKey = "attachments/01JXULIDULIDULIDULIDULIDXX/notes.png";

    it("key listed in spec.attachments is accepted", async () => {
      await seedExecution(attachExecId, attachmentKey);
      const resp = await getArtifactDownloadUrl(
        deps,
        create(GetArtifactDownloadUrlRequestSchema, {
          executionId: attachExecId,
          storageKey: attachmentKey,
        }),
      );
      expect(resp.downloadUrl).not.toBe("");
    });

    it("as_attachment names the download after the attachment file", async () => {
      await seedExecution(attachExecId, attachmentKey);
      const resp = await getArtifactDownloadUrl(
        deps,
        create(GetArtifactDownloadUrlRequestSchema, {
          executionId: attachExecId,
          storageKey: attachmentKey,
          asAttachment: true,
        }),
      );
      expect(resp.downloadUrl).toContain("download=notes.png");
    });

    it("artifact-prefixed key still accepted alongside attachments", async () => {
      await seedExecution(attachExecId, attachmentKey);
      const resp = await getArtifactDownloadUrl(
        deps,
        create(GetArtifactDownloadUrlRequestSchema, {
          executionId: attachExecId,
          storageKey: `artifacts/${attachExecId}/report.md`,
        }),
      );
      expect(resp.downloadUrl).not.toBe("");
    });

    it("attachment key not in spec is rejected", async () => {
      await seedExecution(attachExecId, attachmentKey);
      await expectCode(
        () =>
          getArtifactDownloadUrl(
            deps,
            create(GetArtifactDownloadUrlRequestSchema, {
              executionId: attachExecId,
              storageKey: "attachments/01JXOTHERULIDULIDULIDULIDX/other.png",
            }),
          ),
        Code.InvalidArgument,
      );
    });

    it("execution without the spec entry rejects the same key", async () => {
      // A second execution that never referenced attachmentKey must not
      // presign it — membership is per-execution, not global.
      await seedExecution("aex_other");
      await expectCode(
        () =>
          getArtifactDownloadUrl(
            deps,
            create(GetArtifactDownloadUrlRequestSchema, {
              executionId: "aex_other",
              storageKey: attachmentKey,
            }),
          ),
        Code.InvalidArgument,
      );
    });
  });
});

describe("detectContentType", () => {
  it("prefers the artifact-relevant table, falls back per Go", () => {
    expect(detectContentType("artifacts/x/report.yaml")).toBe("text/yaml");
    expect(detectContentType("artifacts/x/data.json")).toBe(
      "application/json",
    );
    expect(detectContentType("artifacts/x/image.png")).toBe("image/png");
    expect(detectContentType("artifacts/x/unknown.zzz")).toBe(
      "application/octet-stream",
    );
    expect(detectContentType("artifacts/x/no-extension")).toBe(
      "application/octet-stream",
    );
  });
});
