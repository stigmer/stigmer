import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionArtifactKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { InlinePublisher } from "../inline-publisher.js";
import { StatusBuilder } from "../status-builder.js";
import type { ArtifactStorage } from "../../../shared/artifact-storage.js";
import type { WorkspaceBackend } from "../../../shared/workspace/types.js";

function makeStatusBuilder(): StatusBuilder {
  return new StatusBuilder("exec-test", create(AgentExecutionStatusSchema, {}));
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
  const uploadedKeys: string[] = [];
  const uploadedContent = new Map<string, Buffer>();
  return {
    uploadedKeys,
    uploadedContent,
    upload: vi.fn(async (key: string, content: Buffer) => {
      uploadedKeys.push(key);
      uploadedContent.set(key, content);
      return key;
    }),
    getDownloadUrl: vi.fn(async (key: string) => `http://localhost:7235/${key}`),
    exists: vi.fn(async () => false),
  };
}

function sha256(content: string): string {
  return createHash("sha256").update(Buffer.from(content, "utf-8")).digest("hex");
}

describe("InlinePublisher", () => {
  let sb: StatusBuilder;
  let storage: ReturnType<typeof mockArtifactStorage>;
  let backend: WorkspaceBackend;
  let publisher: InlinePublisher;

  beforeEach(() => {
    sb = makeStatusBuilder();
    storage = mockArtifactStorage();
    backend = mockWorkspaceBackend({ "src/main.ts": "console.log('hello');" });
    publisher = new InlinePublisher({
      workspaceBackend: backend,
      artifactStorage: storage,
      statusBuilder: sb,
      executionId: "exec-123",
    });
  });

  it("publishes a file and registers artifact on status", async () => {
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toEqual(["artifacts/exec-123/main.ts"]);
    expect(sb.currentStatus.artifacts).toHaveLength(1);

    const artifact = sb.currentStatus.artifacts[0];
    expect(artifact.name).toBe("main.ts");
    expect(artifact.sandboxPath).toBe("src/main.ts");
    expect(artifact.kind).toBe(ExecutionArtifactKind.FILE);
    expect(artifact.storageKey).toBe("artifacts/exec-123/main.ts");
    expect(artifact.downloadUrl).toBe("http://localhost:7235/artifacts/exec-123/main.ts");
    expect(artifact.contentHash).toBe(sha256("console.log('hello');"));
    expect(Number(artifact.sizeBytes)).toBeGreaterThan(0);
  });

  it("strips leading slashes from paths", async () => {
    await publisher.publish("/src/main.ts");

    expect(sb.currentStatus.artifacts).toHaveLength(1);
    expect(sb.currentStatus.artifacts[0].sandboxPath).toBe("src/main.ts");
  });

  it("deduplicates by path + content hash", async () => {
    await publisher.publish("src/main.ts");
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toHaveLength(1);
    expect(sb.currentStatus.artifacts).toHaveLength(1);
  });

  it("re-publishes when content changes", async () => {
    await publisher.publish("src/main.ts");

    (backend.readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce("updated content");
    await publisher.publish("src/main.ts");

    expect(storage.uploadedKeys).toHaveLength(2);
    expect(sb.currentStatus.artifacts).toHaveLength(1);
    expect(sb.currentStatus.artifacts[0].contentHash).toBe(sha256("updated content"));
  });

  it("exposes published paths for dedup by auto-publish", async () => {
    expect(publisher.publishedPaths.size).toBe(0);

    await publisher.publish("src/main.ts");

    expect(publisher.publishedPaths.has("src/main.ts")).toBe(true);
  });

  it("swallows errors without throwing (fire-and-forget)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failBackend = mockWorkspaceBackend({});

    const pub = new InlinePublisher({
      workspaceBackend: failBackend,
      artifactStorage: storage,
      statusBuilder: sb,
      executionId: "exec-err",
    });

    await pub.publish("nonexistent.txt");

    expect(sb.currentStatus.artifacts).toHaveLength(0);
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

    expect(sb.currentStatus.artifacts).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("computes correct content hash (SHA-256 hex)", async () => {
    await publisher.publish("src/main.ts");

    const expected = createHash("sha256")
      .update(Buffer.from("console.log('hello');", "utf-8"))
      .digest("hex");
    expect(sb.currentStatus.artifacts[0].contentHash).toBe(expected);
  });

  it("guesses content type for common extensions", async () => {
    const jsonBackend = mockWorkspaceBackend({ "data.json": '{"key":"val"}' });
    const pub = new InlinePublisher({
      workspaceBackend: jsonBackend,
      artifactStorage: storage,
      statusBuilder: sb,
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
