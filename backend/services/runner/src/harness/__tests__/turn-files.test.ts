/**
 * The turn's File phase (`turn-context.ts` `mountTurnFiles`): the
 * conversation's Files mounted under `uploads/`, split into this message's
 * and the rest, and the message's images offered to the vision budget.
 *
 * Pinned:
 *  - the mount door is asked only when the session holds a File or the
 *    message carries one; with neither, `uploads/` is still emptied;
 *  - this message's Files come first in the message's order, the rest of
 *    the conversation's after; a document is listed and never shown;
 *  - each message image goes through the vision budget, its bytes read from
 *    where the mount placed them and labelled with that mount path, not the
 *    File's filename, and a degraded one is disclosed by path;
 *  - the budget asks the registry about the model the turn's resolved
 *    settings name, or the registry's default when they name none, never
 *    the model the request asked for, and asks nothing when the message
 *    carries no image.
 *
 * The registry module is doubled at its boundary: this test is about WHICH
 * model is asked and what the phase does with the answer; the budget's
 * decisions over real images are `shared/__tests__/attachment-vision.test.ts`'s,
 * the mount's own rules `shared/__tests__/file-mount.test.ts`'s.
 */

import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { SessionSchema, type Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { FileResourceSchema, SessionResourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { ContentBlockSchema, ContentSourceSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import { FileMountSchema, type FileMount } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";

vi.mock("../../shared/model-registry.js", () => ({
  getDefaultModel: vi.fn(async () => "registry-default-model"),
  getModelVisionCapability: vi.fn(async () => true),
}));

import { getDefaultModel, getModelVisionCapability } from "../../shared/model-registry.js";
import { DEEP_AGENT_VISION_PROFILE } from "../../shared/attachment-vision.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { mountTurnFiles, type ResolutionDeps } from "../turn-context.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SESSION_ID = "ses_turn_files";

const served = new Map<string, Buffer>();
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = served.get(new URL(req.url ?? "/", "http://x").pathname);
    res.statusCode = body === undefined ? 404 : 200;
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let root: string;
let workspace: string;
let originalHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "turn-files-"));
  originalHome = process.env.HOME;
  process.env.HOME = join(root, "home");
  workspace = join(root, "ws");
  mkdirSync(workspace, { recursive: true });
  served.clear();
  vi.mocked(getDefaultModel).mockClear();
  vi.mocked(getModelVisionCapability).mockClear();
  vi.mocked(getModelVisionCapability).mockResolvedValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function deps(client: StigmerClient): ResolutionDeps {
  const status = create(RunStatusSchema, {});
  const rows = create(TurnRowsSchema);
  return {
    input: { executionId: "aex_1", threadId: "", turnSeq: 0 },
    client,
    config: testConfig(),
    status,
    rows,
    transcript: new TranscriptBuilder("aex_1", rows, status),
    artifactStorage: undefined,
    timing: new TimingRecorder(),
    signal: new AbortController().signal,
    heartbeat: () => {},
    enterPhase: () => {},
    reportProgress: async () => {},
    identifyRun: () => {},
    recordReconciled: async () => {},
  };
}

function file(fileId: string, mountPath: string, bytes: Buffer, mimeType: string, filename = mountPath): FileMount {
  served.set(`/${fileId}`, bytes);
  return create(FileMountSchema, {
    fileId,
    mountPath,
    filename,
    mimeType,
    sizeBytes: BigInt(bytes.length),
    url: `${base}/${fileId}?sig=1`,
  });
}

function sessionHolding(fileIds: readonly string[]): Session {
  return create(SessionSchema, {
    spec: create(SessionSpecSchema, {
      resources: fileIds.map((fileId) =>
        create(SessionResourceSchema, { resource: { case: "file", value: create(FileResourceSchema, { fileId }) } }),
      ),
    }),
  });
}

function execution(opts: { readonly messageFiles?: readonly [string, string][]; readonly model?: string; readonly requested?: string } = {}): Run {
  return create(RunSchema, {
    spec: create(RunSpecSchema, opts.requested === undefined ? {} : { runConfig: { modelName: opts.requested } }),
    status: create(RunStatusSchema, {
      ...(opts.model === undefined ? {} : { runConfig: create(RunConfigSchema, { modelName: opts.model }) }),
      messageFiles: (opts.messageFiles ?? []).map(([type, fileId]) =>
        create(ContentBlockSchema, { type, source: create(ContentSourceSchema, { type: "file", fileId }) }),
      ),
    }),
  });
}

async function run(client: StigmerClient, session: Session, exec: Run) {
  return mountTurnFiles(deps(client), {
    execution: exec,
    session,
    sessionId: SESSION_ID,
    primaryDir: workspace,
    visionProfile: DEEP_AGENT_VISION_PROFILE,
  });
}

describe("mountTurnFiles", () => {
  it("asks no door when the conversation holds no File, and still empties uploads/", async () => {
    const leftover = join(getPlatformDir(SESSION_ID), "uploads", "dropped.txt");
    mkdirSync(join(leftover, ".."), { recursive: true });
    writeFileSync(leftover, "from an earlier turn");
    const client = mockStigmerClient();

    const files = await run(client, sessionHolding([]), execution());

    expect(client.mountRunFiles).not.toHaveBeenCalled();
    expect(files).toEqual({ message: [], conversation: [], references: [], visionImages: [], visionNotViewable: [] });
    expect(existsSync(leftover)).toBe(false);
    expect(getModelVisionCapability).not.toHaveBeenCalled();
  });

  it("lists this message's Files first, shows its image, and lists a document without showing it", async () => {
    const entries = [
      file("file_old", "old.csv", Buffer.from("a,b"), "text/csv"),
      file("file_doc", "spec.pdf", Buffer.from("%PDF"), "application/pdf"),
      file("file_img", "shot.png", PNG, "image/png"),
    ];
    const client = mockStigmerClient({
      acquireScopedRunnerToken: vi.fn().mockResolvedValue("scoped"),
      mountRunFiles: vi.fn().mockResolvedValue(entries),
    });

    const files = await run(
      client,
      sessionHolding(["file_old", "file_doc", "file_img"]),
      execution({ model: "claude-haiku-4.5", messageFiles: [["image", "file_img"], ["document", "file_doc"]] }),
    );

    expect(client.mountRunFiles).toHaveBeenCalledWith("aex_1", "scoped");
    expect(files.message.map((f) => [f.relativePath, f.kind])).toEqual([
      [".stigmer/uploads/shot.png", "image"],
      [".stigmer/uploads/spec.pdf", "document"],
    ]);
    expect(files.conversation.map((f) => f.relativePath)).toEqual([".stigmer/uploads/old.csv"]);
    expect(files.visionImages.map((v) => v.filename)).toEqual(["shot.png"]);
    expect(files.visionNotViewable).toEqual([]);
    expect(getModelVisionCapability).toHaveBeenCalledWith("claude-haiku-4.5");
    expect(getDefaultModel).not.toHaveBeenCalled();
  });

  it("labels a message image with its mount path when the File's filename was taken", async () => {
    const entries = [
      file("file_first", "image.png", PNG, "image/png"),
      file("file_second", "image-2.png", PNG, "image/png", "image.png"),
    ];
    const client = mockStigmerClient({ mountRunFiles: vi.fn().mockResolvedValue(entries) });

    const files = await run(client, sessionHolding(["file_first", "file_second"]), execution({ messageFiles: [["image", "file_second"]] }));

    expect(files.message.map((f) => [f.filename, f.relativePath])).toEqual([["image.png", ".stigmer/uploads/image-2.png"]]);
    expect(files.visionImages.map((v) => v.filename)).toEqual(["image-2.png"]);
  });

  it("discloses a message image the model cannot see by its path", async () => {
    vi.mocked(getModelVisionCapability).mockResolvedValue(false);
    const client = mockStigmerClient({ mountRunFiles: vi.fn().mockResolvedValue([file("file_img", "shot.png", PNG, "image/png")]) });

    const files = await run(client, sessionHolding([]), execution({ model: "blind-model", messageFiles: [["image", "file_img"]] }));

    expect(files.visionImages).toEqual([]);
    expect(files.visionNotViewable).toEqual([{ path: ".stigmer/uploads/shot.png", reason: "model_no_vision" }]);
  });

  it("neither shows nor discloses a message 'image' whose bytes and type are no image", async () => {
    const client = mockStigmerClient({
      mountRunFiles: vi.fn().mockResolvedValue([file("file_txt", "notes.txt", Buffer.from("plain"), "text/plain")]),
    });

    const files = await run(client, sessionHolding([]), execution({ messageFiles: [["image", "file_txt"]] }));

    expect(files.visionImages).toEqual([]);
    expect(files.visionNotViewable).toEqual([]);
  });

  it("asks about the registry's default when the resolved settings name no model, never the requested one", async () => {
    const client = mockStigmerClient({ mountRunFiles: vi.fn().mockResolvedValue([file("file_img", "shot.png", PNG, "image/png")]) });

    await run(client, sessionHolding(["file_img"]), execution({ requested: "requested-model", messageFiles: [["image", "file_img"]] }));

    expect(getDefaultModel).toHaveBeenCalledTimes(1);
    expect(getModelVisionCapability).toHaveBeenCalledWith("registry-default-model");
    expect(getModelVisionCapability).not.toHaveBeenCalledWith("requested-model");
  });

  it("asks nothing of the registry when the message carries no image", async () => {
    const client = mockStigmerClient({ mountRunFiles: vi.fn().mockResolvedValue([file("file_doc", "a.pdf", Buffer.from("%PDF"), "application/pdf")]) });

    const files = await run(client, sessionHolding(["file_doc"]), execution({ messageFiles: [["document", "file_doc"]] }));

    expect(files.message).toHaveLength(1);
    expect(getModelVisionCapability).not.toHaveBeenCalled();
  });
});
