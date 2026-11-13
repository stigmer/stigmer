/**
 * Proves the vision input path end-to-end through the REAL framework
 * stack: the exact `{ role: "user", content: [...] }` shape that turn-setup.ts
 * builds is driven through `createDeepAgent` (the production graph factory,
 * default middleware included) and the test asserts what the chat model's
 * `_generate` actually received.
 *
 * This is the offline stand-in for the deferred live provider probes: it
 * cannot prove Anthropic renders the pixels, but it proves the
 * image blocks survive the LangGraph message reducer and the full deepagents
 * middleware stack byte-identically — the part of the path we own.
 *
 * The thread holds pointers (stigmer/stigmer#3087): a session's turns run
 * as production runs them, each on a graph of its own over one
 * checkpointer, its input from `composeGraphInput`, its images mounted
 * under a temp `~/.stigmer` by the real File mount, and the image-ref
 * middleware (`../image-ref-middleware.ts`) last in Stigmer's list. On the
 * memory and the SQLite checkpointer alike: no saved checkpoint or write
 * holds the image's bytes, while every model call of both turns receives
 * them, the second turn's first user message unchanged from the first's;
 * a File the conversation dropped reaches the model as its text line; and
 * a graph reads each image from the mount once, whatever its calls.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { create } from "@bufbuild/protobuf";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { FileMountSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/run_files_pb";
import { createDeepAgent } from "deepagents";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../../../shared/filereview/cas-capture-observer.js";
import {
  ScriptedModel,
  completedToolRounds,
  type ScriptSelector,
} from "../__test-utils__/scripted-model.js";
import {
  DEEP_AGENT_VISION_PROFILE,
  VisionBudget,
  toLangChainImageBlock,
  type LangChainContentBlock,
  type VisionImage,
} from "../../../shared/attachment-vision.js";
import { installAgentFs, localAgentFs } from "../../../shared/agent-fs.js";
import { SqliteCheckpointSaver } from "../../../shared/checkpointer/sqlite-saver.js";
import { mountFiles, offerMountedImage, type MountedFile } from "../../../shared/file-mount.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { composeGraphInput, type DeepAgentGraphInput } from "../turn-setup.js";
import { IMAGE_REMOVED_TEXT, createImageRefMiddleware } from "../image-ref-middleware.js";

/**
 * A ScriptedModel that records every `_generate` input. `bindTools` must
 * return a NEW capturing instance sharing the same capture array — the base
 * class re-instantiates itself on bind, which would silently drop the spy.
 */
class CapturingModel extends ScriptedModel {
  constructor(
    private readonly selectFn: ScriptSelector,
    private readonly captured: BaseMessage[][],
  ) {
    super(selectFn);
  }

  // Reports as ChatAnthropic so createDeepAgent engages the same
  // anthropic-prompt-caching middleware a production run gets — the stack the
  // image blocks must survive.
  override getName(): string {
    return "ChatAnthropic";
  }

  override bindTools(tools: unknown[]): this {
    const next = new CapturingModel(this.selectFn, this.captured);
    next.toolNames = (tools as Array<{ name?: string }>).map((t) => t?.name ?? "");
    return next as unknown as this;
  }

  override async _generate(messages: BaseMessage[], options: this["ParsedCallOptions"]): Promise<ChatResult> {
    this.captured.push(messages);
    return super._generate(messages, options);
  }
}

function makeVisionImage(filename: string): VisionImage {
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 0xab),
  ]);
  const outcome = new VisionBudget(DEEP_AGENT_VISION_PROFILE).offer(
    "file_photo",
    filename,
    "image/png",
    pngBytes,
  );
  if (outcome.kind !== "accepted") throw new Error("fixture PNG must be accepted");
  return outcome.image;
}

describe("deep-agent vision input through the real graph", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vision-input-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * `content` is a user message as a thread saved before pointers holds it:
   * a plain string, or the label and inline image blocks plus the composed
   * text block.
   */
  async function invokeGraphWith(
    content: string | LangChainContentBlock[],
  ): Promise<BaseMessage[][]> {
    const captured: BaseMessage[][] = [];
    const script: ScriptSelector = () => ({ toolCalls: [], done: "seen" });

    const observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => false });
    const backend = await createCasCaptureBackend({ rootDir: root, observer, shellEnv: {} });

    const agent = await createDeepAgent({
      model: new CapturingModel(script, captured),
      checkpointer: new MemorySaver() as never,
      backend,
    } as Parameters<typeof createDeepAgent>[0]);

    // The EXACT input shape turn-setup.ts constructs (plain role/content dict, not
    // a HumanMessage instance — the reducer does the coercion in production).
    await agent.invoke(
      { messages: [{ role: "user", content }] },
      { configurable: { thread_id: "vision-thread" }, recursionLimit: 10 },
    );
    return captured;
  }

  it("delivers image_url blocks (labels first, text last) to the model byte-identically", async () => {
    const image = makeVisionImage("photo.png");
    const content: LangChainContentBlock[] = [
      { type: "text", text: "Image 1: photo.png" },
      toLangChainImageBlock(image),
      { type: "text", text: "what is in this image?" },
    ];

    const captured = await invokeGraphWith(content);

    expect(captured.length).toBeGreaterThan(0);
    const human = captured[0].find((m): m is HumanMessage => m instanceof HumanMessage);
    expect(human).toBeDefined();
    expect(human!.content).toEqual([
      { type: "text", text: "Image 1: photo.png" },
      {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${image.base64}` },
      },
      { type: "text", text: "what is in this image?" },
    ]);
  });

  it("keeps a plain-string user message untouched (the no-attachment path)", async () => {
    const captured = await invokeGraphWith("just text, no images");

    const human = captured[0].find((m): m is HumanMessage => m instanceof HumanMessage);
    expect(human).toBeDefined();
    expect(human!.content).toBe("just text, no images");
  });
});

/** A PNG whose bytes spell nothing else: its base64 is found only where the image is. */
const PHOTO = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7 + 13) % 251)),
]);
const PHOTO_BASE64 = PHOTO.toString("base64");
const PHOTO_BLOCK = { type: "image_url", image_url: { url: `data:image/png;base64,${PHOTO_BASE64}` } };
const SESSION = "ses_vision_refs";
const THREAD = `thread-${SESSION}`;

describe("a conversation's images ride the thread as pointers", () => {
  let root: string;
  let workspace: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "vision-refs-"));
    originalHome = process.env.HOME;
    process.env.HOME = join(root, "home");
    workspace = join(root, "ws");
    await mkdir(workspace, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(root, { recursive: true, force: true });
  });

  /** The conversation's Files mounted as a turn mounts them: the photo, or none once it was dropped. */
  async function mountConversation(withPhoto: boolean): Promise<MountedFile[]> {
    const entries = withPhoto
      ? [create(FileMountSchema, {
          fileId: "file_photo",
          mountPath: "photo.png",
          filename: "photo.png",
          mimeType: "image/png",
          sizeBytes: BigInt(PHOTO.length),
          url: `data:application/octet-stream;base64,${PHOTO_BASE64}`,
        })]
      : [];
    return mountFiles(entries, { sessionId: SESSION, primaryWorkspaceDir: workspace });
  }

  /** The photo as the runtime's File phase accepts it. */
  async function acceptedPhoto(file: MountedFile): Promise<VisionImage> {
    const outcome = await offerMountedImage(file, SESSION, new VisionBudget(DEEP_AGENT_VISION_PROFILE));
    if (outcome.kind !== "accepted") throw new Error("the photo must be accepted");
    return outcome.image;
  }

  /**
   * One turn as production runs it: a graph of its own over the session's
   * checkpointer, the image-ref middleware last in Stigmer's list, the
   * input `composeGraphInput` composes. The first turn calls a tool, so it
   * asks the model twice; every later turn answers at once.
   */
  async function runTurn(
    checkpointer: BaseCheckpointSaver,
    captured: BaseMessage[][],
    turn: { readonly executionId: string; readonly message: string; readonly images: readonly VisionImage[] },
  ): Promise<void> {
    const script: ScriptSelector = () => (transcript) =>
      completedToolRounds(transcript) === 0
        ? { toolCalls: [{ name: "ls", args: { path: "/" }, id: `call_ls_${turn.executionId}` }] }
        : { text: "seen" };
    const observer = new CasCaptureObserver({ rootDir: workspace, isIgnored: async () => false });
    const backend = await createCasCaptureBackend({ rootDir: workspace, observer, shellEnv: {} });
    const graph = await createDeepAgent({
      model: new CapturingModel(script, captured),
      checkpointer: checkpointer as never,
      backend,
      middleware: [createImageRefMiddleware({ sessionId: SESSION })],
    } as Parameters<typeof createDeepAgent>[0]);
    const langgraphConfig = { configurable: { thread_id: THREAD }, recursionLimit: 20 };
    const input = turnInputFixture({
      sessionId: SESSION,
      executionId: turn.executionId,
      threadId: THREAD,
      message: turn.message,
      files: { message: [], conversation: [], references: [], visionImages: turn.images, visionNotViewable: [] },
    });
    const composed: DeepAgentGraphInput = await composeGraphInput(input, { graph, langgraphConfig, hasStructuredOutput: false });
    if (composed.kind !== "message") throw new Error(`a new turn composes a message, got ${composed.kind}`);
    await graph.invoke(composed.input, langgraphConfig);
  }

  /** The first user message each model call was sent. */
  function firstHumanOf(call: readonly BaseMessage[]): HumanMessage {
    const human = call.find((m): m is HumanMessage => HumanMessage.isInstance(m));
    if (human === undefined) throw new Error("a call without a user message");
    return human;
  }

  /** Everything the checkpointer holds for the thread, as the saver answers it. */
  async function savedThread(checkpointer: BaseCheckpointSaver): Promise<string> {
    const tuples: unknown[] = [];
    for await (const tuple of checkpointer.list({ configurable: { thread_id: THREAD } })) tuples.push(tuple);
    expect(tuples.length).toBeGreaterThan(0);
    return JSON.stringify(tuples);
  }

  const savers: ReadonlyArray<readonly [string, (dir: string) => { saver: BaseCheckpointSaver; raw: () => Buffer[] }]> = [
    ["memory", () => ({ saver: new MemorySaver(), raw: () => [] })],
    [
      "sqlite",
      (dir) => {
        const path = join(dir, "checkpoints.db");
        return {
          saver: new SqliteCheckpointSaver(path),
          raw: () => {
            const db = new DatabaseSync(path);
            try {
              const rows = [
                ...db.prepare("SELECT checkpoint AS a, metadata AS b FROM checkpoints").all(),
                ...db.prepare("SELECT value AS a, value AS b FROM writes").all(),
              ] as Array<{ a: Uint8Array | null; b: Uint8Array | null }>;
              return rows.flatMap((row) => [row.a, row.b]).filter((v): v is Uint8Array => v !== null).map((v) => Buffer.from(v));
            } finally {
              db.close();
            }
          },
        };
      },
    ],
  ];

  for (const [kind, open] of savers) {
    it(`saves no image bytes on the ${kind} checkpointer, while every call of both turns receives them`, async () => {
      const { saver, raw } = open(root);
      const [mounted] = await mountConversation(true);
      const photo = await acceptedPhoto(mounted!);
      const captured: BaseMessage[][] = [];

      await runTurn(saver, captured, { executionId: "run_one", message: "what is in this image?", images: [photo] });
      await mountConversation(true);
      await runTurn(saver, captured, { executionId: "run_two", message: "and the colours?", images: [] });

      expect(captured).toHaveLength(3);
      for (const call of captured) {
        expect(firstHumanOf(call).content).toEqual([
          { type: "text", text: "Image 1: photo.png" },
          PHOTO_BLOCK,
          expect.objectContaining({ type: "text" }),
        ]);
      }
      // The prefix a prompt cache keys on: the second turn sends the first
      // turn's message byte for byte.
      expect(JSON.stringify(firstHumanOf(captured[2]!).content)).toBe(JSON.stringify(firstHumanOf(captured[0]!).content));

      const saved = await savedThread(saver);
      expect(saved).toContain('[stigmer-image file=\\"file_photo\\"]');
      expect(saved).not.toContain(PHOTO_BASE64);
      for (const bytes of raw()) expect(bytes.includes(PHOTO_BASE64)).toBe(false);
    });
  }

  it("shows a File the conversation dropped as its text line, after the label that names it", async () => {
    const saver = new MemorySaver();
    const [mounted] = await mountConversation(true);
    const photo = await acceptedPhoto(mounted!);
    const captured: BaseMessage[][] = [];

    await runTurn(saver, captured, { executionId: "run_one", message: "what is in this image?", images: [photo] });
    await mountConversation(false);
    await runTurn(saver, captured, { executionId: "run_two", message: "and now?", images: [] });

    expect(captured).toHaveLength(3);
    expect(firstHumanOf(captured[2]!).content).toEqual([
      { type: "text", text: "Image 1: photo.png" },
      { type: "text", text: IMAGE_REMOVED_TEXT },
      expect.objectContaining({ type: "text" }),
    ]);
    expect(JSON.stringify(captured[2])).not.toContain(PHOTO_BASE64);
  });

  it("reads each image from the mount once per graph, whatever its calls", async () => {
    const saver = new MemorySaver();
    const [mounted] = await mountConversation(true);
    const photo = await acceptedPhoto(mounted!);
    const captured: BaseMessage[][] = [];
    const photoPath = join(process.env.HOME!, ".stigmer", "sessions", SESSION, "platform", "uploads", "photo.png");
    const reads: string[] = [];
    const restore = installAgentFs({
      ...localAgentFs,
      readFile: async (path) => {
        if (path === photoPath) reads.push(path);
        return localAgentFs.readFile(path);
      },
    });
    try {
      await runTurn(saver, captured, { executionId: "run_one", message: "what is in this image?", images: [photo] });
      expect(captured).toHaveLength(2);
      expect(reads).toHaveLength(1);
      await runTurn(saver, captured, { executionId: "run_two", message: "and the colours?", images: [] });
      expect(reads).toHaveLength(2);
    } finally {
      restore();
    }
  });
});
