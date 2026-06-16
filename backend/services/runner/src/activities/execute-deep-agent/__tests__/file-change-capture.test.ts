import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { LocalWorkspaceBackend } from "../../../shared/workspace/local-backend.js";
import { buildFileChange } from "../../../shared/file-change.js";
import { CapturingFilesystemBackend } from "../capturing-filesystem-backend.js";
import { FileChangeCaptureBuffer } from "../file-change-buffer.js";
import { FileChangeCoordinator } from "../file-change-coordinator.js";
import { StatusBuilder } from "../status-builder.js";
import { V3StatusBuilder } from "../v3-status-builder.js";
import type { ExecutionStatusWriter } from "../execution-status-writer.js";

describe("FileChangeCaptureBuffer", () => {
  it("returns captures FIFO per path and normalizes leading slashes", () => {
    const buffer = new FileChangeCaptureBuffer();
    buffer.push({ path: "/a.ts", changeType: FileChangeType.MODIFY, before: "1", after: "2" });
    buffer.push({ path: "a.ts", changeType: FileChangeType.MODIFY, before: "2", after: "3" });

    // Both keys normalize to "a.ts"; oldest first.
    expect(buffer.popOldest("a.ts")?.before).toBe("1");
    expect(buffer.popOldest("/a.ts")?.before).toBe("2");
    expect(buffer.popOldest("a.ts")).toBeUndefined();
  });
});

describe("CapturingFilesystemBackend", () => {
  let dir: string;
  let reader: LocalWorkspaceBackend;
  let buffer: FileChangeCaptureBuffer;
  let backend: CapturingFilesystemBackend;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fc-capture-"));
    reader = new LocalWorkspaceBackend(dir);
    buffer = new FileChangeCaptureBuffer();
    backend = new CapturingFilesystemBackend({ rootDir: dir }, { buffer, reader });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("records a CREATE with no before for a write to a new file", async () => {
    await backend.write("new.ts", "hello world");
    const capture = buffer.popOldest("new.ts");
    expect(capture).toBeDefined();
    expect(capture?.changeType).toBe(FileChangeType.CREATE);
    expect(capture?.before).toBeUndefined();
    expect(capture?.after).toBe("hello world");
  });

  it("records a MODIFY with true before/after for an edit", async () => {
    await backend.write("edit.ts", "alpha beta");
    buffer.popOldest("edit.ts"); // discard the CREATE
    await backend.edit("edit.ts", "beta", "gamma");

    const capture = buffer.popOldest("edit.ts");
    expect(capture?.changeType).toBe(FileChangeType.MODIFY);
    expect(capture?.before).toBe("alpha beta");
    expect(capture?.after).toBe("alpha gamma");
  });

  it("records nothing when an edit fails (oldString not found)", async () => {
    await backend.write("nochange.ts", "content");
    buffer.popOldest("nochange.ts"); // discard the CREATE

    // deepagents returns failure as a value (error set), not a throw, and leaves
    // the file untouched — the wrapper must not record a spurious no-op MODIFY.
    const result = await backend.edit("nochange.ts", "MISSING", "x");
    expect(result.error).toBeTruthy();
    expect(buffer.popOldest("nochange.ts")).toBeUndefined();
  });

  it("records nothing when a write fails (file already exists)", async () => {
    await backend.write("exists.ts", "first");
    buffer.popOldest("exists.ts"); // discard the CREATE

    // deepagents' write is create-only: a second write to the same path returns
    // an error value and leaves the file untouched. The wrapper gates capture on
    // result.error, so it must not record a phantom change for the failed write.
    const result = await backend.write("exists.ts", "second");
    expect(result.error).toBeTruthy();
    expect(buffer.popOldest("exists.ts")).toBeUndefined();
  });

  it("flags a binary write (NUL byte) on the captured after content", async () => {
    await backend.write("logo.bin", "PNG\u0000\u0000data");
    const capture = buffer.popOldest("logo.bin");
    expect(capture?.after).toContain("\u0000");
    // buildFileChange derives is_binary from the content via looksBinary.
    const fc = buildFileChange({
      path: "logo.bin",
      absolutePath: join(dir, "logo.bin"),
      changeType: FileChangeType.CREATE,
      captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
      after: capture?.after,
    });
    expect(fc.after?.isBinary).toBe(true);
  });

  it("orders repeated edits of one file FIFO", async () => {
    await backend.write("repeat.ts", "v0");
    buffer.popOldest("repeat.ts"); // discard the CREATE
    await backend.edit("repeat.ts", "v0", "v1");
    await backend.edit("repeat.ts", "v1", "v2");

    expect(buffer.popOldest("repeat.ts")?.after).toBe("v1");
    expect(buffer.popOldest("repeat.ts")?.after).toBe("v2");
  });
});

/** Build a status carrying a single tool call with the given id. */
function statusWithToolCallId(toolCallId: string) {
  return create(AgentExecutionStatusSchema, {
    messages: [
      create(AgentMessageSchema, {
        toolCalls: [create(ToolCallSchema, { id: toolCallId, name: "edit_file" })],
      }),
    ],
  });
}

describe("attachFileChanges (shared proto search)", () => {
  function sampleChange(): FileChange[] {
    return [
      buildFileChange({
        path: "src/x.ts",
        absolutePath: "/root/src/x.ts",
        changeType: FileChangeType.MODIFY,
        captureLevel: FileChangeCaptureLevel.WHOLE_FILE,
        before: "a",
        after: "b",
      }),
    ];
  }

  it("V3StatusBuilder attaches by tc.id on the shared proto", () => {
    const status = statusWithToolCallId("call-1");
    const builder = new V3StatusBuilder("exec-1", status);
    builder.attachFileChanges("call-1", sampleChange());
    expect(status.messages[0].toolCalls[0].fileChanges).toHaveLength(1);
    expect(status.messages[0].toolCalls[0].fileChanges[0].path).toBe("src/x.ts");
  });

  it("StatusBuilder (v2) attaches by tc.id on the shared proto", () => {
    const status = statusWithToolCallId("run-1");
    const builder = new StatusBuilder("exec-1", status);
    builder.attachFileChanges("run-1", sampleChange());
    expect(status.messages[0].toolCalls[0].fileChanges).toHaveLength(1);
  });

  it("is a no-op when no tool call matches", () => {
    const status = statusWithToolCallId("call-1");
    const builder = new V3StatusBuilder("exec-1", status);
    builder.attachFileChanges("does-not-exist", sampleChange());
    expect(status.messages[0].toolCalls[0].fileChanges).toHaveLength(0);
  });
});

describe("FileChangeCoordinator.attach", () => {
  function fakeWriter() {
    const calls: { toolCallId: string; changes: FileChange[] }[] = [];
    const writer = {
      attachFileChanges: (toolCallId: string, changes: FileChange[]) => {
        calls.push({ toolCallId, changes });
      },
    } as unknown as ExecutionStatusWriter;
    return { writer, calls };
  }

  it("pops the capture, builds a WHOLE_FILE change, and attaches it", () => {
    const buffer = new FileChangeCaptureBuffer();
    buffer.push({ path: "src/app.ts", changeType: FileChangeType.MODIFY, before: "a", after: "b" });
    const { writer, calls } = fakeWriter();

    const coordinator = new FileChangeCoordinator({
      statusWriter: writer,
      buffer,
      workspaceBackend: { rootDir: "/root" } as never,
    });
    coordinator.attach("tc-1", "src/app.ts");

    expect(calls).toHaveLength(1);
    expect(calls[0].toolCallId).toBe("tc-1");
    const fc = calls[0].changes[0];
    expect(fc.changeType).toBe(FileChangeType.MODIFY);
    expect(fc.captureLevel).toBe(FileChangeCaptureLevel.WHOLE_FILE);
    expect(fc.path).toBe("src/app.ts");
    expect(fc.absolutePath).toBe("/root/src/app.ts");
    expect(fc.before?.body.case).toBe("inline");
    expect(fc.after?.body.case).toBe("inline");
  });

  it("omits before for a CREATE", () => {
    const buffer = new FileChangeCaptureBuffer();
    buffer.push({ path: "new.ts", changeType: FileChangeType.CREATE, before: undefined, after: "x" });
    const { writer, calls } = fakeWriter();

    const coordinator = new FileChangeCoordinator({
      statusWriter: writer,
      buffer,
      workspaceBackend: { rootDir: "/root" } as never,
    });
    coordinator.attach("tc-2", "new.ts");

    const fc = calls[0].changes[0];
    expect(fc.changeType).toBe(FileChangeType.CREATE);
    expect(fc.before).toBeUndefined();
    expect(fc.after?.body.case).toBe("inline");
  });

  it("is a no-op when the path has no buffered capture", () => {
    const buffer = new FileChangeCaptureBuffer();
    const { writer, calls } = fakeWriter();
    const coordinator = new FileChangeCoordinator({
      statusWriter: writer,
      buffer,
      workspaceBackend: { rootDir: "/root" } as never,
    });
    coordinator.attach("tc-3", "untouched.ts");
    expect(calls).toHaveLength(0);
  });
});
