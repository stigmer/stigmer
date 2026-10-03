import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "@bufbuild/protobuf";
import { type AgentExecutionStatus, AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionArtifactSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import { InlinePublisher } from "../inline-publisher.js";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { LocalWorkspaceBackend } from "../../../shared/workspace/local-backend.js";
import type { ArtifactStorage } from "../../../shared/artifact-storage.js";
import { makeInMemoryArtifactStorage } from "../../../__test-utils__/fake-artifact-storage.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";

// The publisher registers artifacts on the transcript builder (`addArtifact`);
// the one builder since #1096.
/** A builder and the status it builds into: the test writes through `sb` and reads `status`, as production reads `TurnSink.status`. */
function makeStatusBuilder(): { sb: TranscriptBuilder; status: AgentExecutionStatus } {
  const status = create(AgentExecutionStatusSchema, {});
  return { sb: new TranscriptBuilder("exec-test", status), status };
}

function mockWorkspaceBackend(files: Record<string, string>): WorkspaceBackend {
  return {
    rootDir: "/workspace",
    execute: vi.fn(),
    readFile: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    }),
    writeFile: vi.fn(),
    writeFileBuffer: vi.fn(),
    exists: vi.fn(async (path: string) => path in files),
  };
}

function mockArtifactStorage(): ArtifactStorage & {
  uploadedKeys: string[];
  uploadedContent: Map<string, Buffer>;
} {
  // Canonical double; `uploadedKeys`/`uploadedContent` mirror the backing store
  // so the existing assertions keep working and `download` reads back uploads.
  const { storage, blobs } = makeInMemoryArtifactStorage({ urlBase: "http://localhost:7235/" });
  const uploadedKeys: string[] = [];
  storage.upload.mockImplementation(async (key: string, content: Buffer) => {
    uploadedKeys.push(key);
    blobs.set(key, Buffer.from(content));
    return key;
  });
  return Object.assign(storage, { uploadedKeys, uploadedContent: blobs });
}

function sha256(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
}

describe("InlinePublisher", () => {
  let sb: TranscriptBuilder;
  let status: AgentExecutionStatus;
  let storage: ReturnType<typeof mockArtifactStorage>;
  let backend: WorkspaceBackend;
  let publisher: InlinePublisher;

  beforeEach(() => {
    ({ sb, status } = makeStatusBuilder());
    storage = mockArtifactStorage();
    backend = mockWorkspaceBackend({ "src/main.ts": "console.log('hello');" });
    publisher = new InlinePublisher({
      workspaceBackend: backend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-123",
    });
  });

  it("publishes a file and registers artifact on status", async () => {
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toEqual(["artifacts/exec-123/main.ts"]);
    expect(status.artifacts).toHaveLength(1);

    const artifact = status.artifacts[0];
    expect(artifact.name).toBe("main.ts");
    expect(artifact.sandboxPath).toBe("src/main.ts");
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.storageKey).toBe("artifacts/exec-123/main.ts");
    expect(artifact.contentHash).toBe(sha256("console.log('hello');"));
    expect(Number(artifact.sizeBytes)).toBeGreaterThan(0);
  });

  it("strips leading slashes from paths", async () => {
    await publisher.publish("/src/main.ts");

    expect(status.artifacts).toHaveLength(1);
    expect(status.artifacts[0].sandboxPath).toBe("src/main.ts");
  });

  it("stamps createdAt when the publish is asked for, never when the upload returns", async () => {
    // The stream asks for the publish as it folds the write's finish, and the
    // upload runs on beside the stream; a slow store must not move the stamp.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(2026, 0, 1) });
    try {
      const askedAt = new Date().toISOString();
      vi.mocked(storage.upload).mockImplementationOnce(async (key: string) => {
        vi.setSystemTime(Date.now() + 5_000);
        return key;
      });

      await publisher.publish("src/main.ts");

      expect(status.artifacts[0].createdAt).toBe(askedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates by path + content hash", async () => {
    await publisher.publish("src/main.ts");
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toHaveLength(1);
    expect(status.artifacts).toHaveLength(1);
  });

  it("re-publishes when content changes", async () => {
    await publisher.publish("src/main.ts");

    (backend.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("updated content");
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toHaveLength(2);
    expect(status.artifacts).toHaveLength(1);
    expect(status.artifacts[0].contentHash).toBe(sha256("updated content"));
  });

  it("exposes published paths for dedup by auto-publish", async () => {
    expect(publisher.publishedPaths.size).toBe(0);

    await publisher.publish("src/main.ts");

    expect(publisher.publishedPaths.has("src/main.ts")).toBe(true);
  });

  // A reinvocation seeds the earlier turns' rows onto the status before the
  // turn's publisher exists; the safety net then asks for those paths again.
  describe("against rows the status already lists (stigmer/stigmer#1448)", () => {
    function seedRow(sandboxPath: string, content: string): void {
      status.artifacts.push(create(ExecutionArtifactSchema, {
        name: sandboxPath.split("/").at(-1) ?? sandboxPath,
        sandboxPath,
        kind: ExecutionArtifactKind.FILE,
        storageKey: `artifacts/exec-123/${sandboxPath.split("/").at(-1)}`,
        contentHash: sha256(content),
      }));
    }

    it("uploads nothing for a file whose bytes the status already lists, and counts it as brought up to date", async () => {
      seedRow("src/main.ts", "console.log('hello');");
      const seeded = status.artifacts[0];

      await publisher.publish("src/main.ts");

      expect(storage.uploadedKeys, "the unchanged file is not sent again").toEqual([]);
      expect(status.artifacts, "the seeded row is kept as it was").toEqual([seeded]);
      expect(publisher.publishedPaths.has("src/main.ts")).toBe(true);
    });

    it("uploads and replaces the row when the file changed since the status listed it", async () => {
      seedRow("src/main.ts", "an earlier turn's bytes");

      await publisher.publish("src/main.ts");

      expect(storage.uploadedKeys).toEqual(["artifacts/exec-123/main.ts"]);
      expect(status.artifacts).toHaveLength(1);
      expect(status.artifacts[0].contentHash).toBe(sha256("console.log('hello');"));
    });

    it("still reads the file, so a rewrite made outside a write tool is caught", async () => {
      seedRow("src/main.ts", "console.log('hello');");

      await publisher.publish("src/main.ts");

      expect(backend.readFile).toHaveBeenCalledWith("src/main.ts");
    });

    it("leaves an earlier turn's path out of publishedPaths until this turn checks it", () => {
      seedRow("src/main.ts", "console.log('hello');");

      expect(publisher.publishedPaths.size).toBe(0);
    });

    it("uploads a file the status lists under another path", async () => {
      seedRow("docs/main.ts", "console.log('hello');");

      await publisher.publish("src/main.ts");

      expect(storage.uploadedKeys).toEqual(["artifacts/exec-123/main.ts"]);
      expect(status.artifacts.map((a) => a.sandboxPath)).toEqual(["docs/main.ts", "src/main.ts"]);
    });
  });

  it("swallows errors without throwing (fire-and-forget)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failBackend = mockWorkspaceBackend({});

    const pub = new InlinePublisher({
      workspaceBackend: failBackend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-err",
    });

    await pub.publish("nonexistent.txt");

    expect(status.artifacts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[InlinePublisher]"),
    );
    warnSpy.mockRestore();
  });

  it("swallows storage upload errors", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (storage.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("storage down"),
    );

    await publisher.publish("src/main.ts");

    expect(status.artifacts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("computes correct content hash (SHA-256 hex)", async () => {
    await publisher.publish("src/main.ts");

    const expected = createHash("sha256")
      .update(Buffer.from("console.log('hello');", "utf-8"))
      .digest("hex");
    expect(status.artifacts[0].contentHash).toBe(expected);
  });

  it("never publishes a secret-like file to artifact storage", async () => {
    // Under the global bypass a secret write is not blocked up front, so it would
    // otherwise be uploaded here. The publisher must withhold it: no read, no
    // upload, no registered artifact — the secret's bytes never reach storage.
    const secretBackend = mockWorkspaceBackend({ ".env": "API_KEY=super-secret-value" });
    const readSpy = secretBackend.readFile as ReturnType<typeof vi.fn>;
    const pub = new InlinePublisher({
      workspaceBackend: secretBackend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-secret",
    });

    await pub.publish(".env");

    expect(storage.uploadedKeys).toHaveLength(0);
    expect(status.artifacts).toHaveLength(0);
    expect(readSpy).not.toHaveBeenCalled(); // withheld before the file is even read
    expect(pub.publishedPaths.size).toBe(0);
  });

  it("guesses content type for common extensions", async () => {
    const jsonBackend = mockWorkspaceBackend({ "data.json": '{"key":"val"}' });
    const pub = new InlinePublisher({
      workspaceBackend: jsonBackend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-ct",
    });

    await pub.publish("data.json");

    expect(storage.upload).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      "application/json",
    );
  });
});

describe("InlinePublisher with LocalWorkspaceBackend (disk-backed)", () => {
  it("publishes files written to the real filesystem", async () => {
    const dir = join(tmpdir(), `stigmer-publisher-test-${Date.now()}`);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src/app.ts"), "export const x = 42;", "utf-8");

    const status = create(AgentExecutionStatusSchema, {});
    const sb = new TranscriptBuilder("exec-disk", status);
    const storage = mockArtifactStorage();
    const backend = new LocalWorkspaceBackend(dir);

    const publisher = new InlinePublisher({
      workspaceBackend: backend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-disk",
    });

    await publisher.publish("src/app.ts");

    expect(status.artifacts).toHaveLength(1);
    const artifact = status.artifacts[0];
    expect(artifact.name).toBe("app.ts");
    expect(artifact.sandboxPath).toBe("src/app.ts");
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.contentHash).toBe(sha256("export const x = 42;"));
    expect(Number(artifact.sizeBytes)).toBe(20);
    expect(storage.uploadedKeys).toEqual(["artifacts/exec-disk/app.ts"]);
  });

  it("fails gracefully when file does not exist on disk", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const dir = join(tmpdir(), `stigmer-publisher-test-${Date.now()}`);
    await mkdir(dir, { recursive: true });

    const status = create(AgentExecutionStatusSchema, {});
    const sb = new TranscriptBuilder("exec-miss", status);
    const storage = mockArtifactStorage();
    const backend = new LocalWorkspaceBackend(dir);

    const publisher = new InlinePublisher({
      workspaceBackend: backend,
      artifactStorage: storage,
      artifacts: sb,
      record: status,
      executionId: "exec-miss",
    });

    await publisher.publish("nonexistent.ts");

    expect(status.artifacts).toHaveLength(0);
    expect(storage.uploadedKeys).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[InlinePublisher]"),
    );
    warnSpy.mockRestore();
  });
});
