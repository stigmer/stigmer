/**
 * Proves the T04 vision input path end-to-end through the REAL framework
 * stack: the exact `{ role: "user", content: [...] }` shape that setup.ts
 * builds is driven through `createDeepAgent` (the production graph factory,
 * default middleware included) and the test asserts what the chat model's
 * `_generate` actually received.
 *
 * This is the offline stand-in for the deferred live provider probes (T01
 * A4/A5): it cannot prove Anthropic renders the pixels, but it proves the
 * image blocks survive the LangGraph message reducer and the full deepagents
 * middleware stack byte-identically — the part of the path we own.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import {
  ScriptedModel,
  type ScriptSelector,
} from "../__test-utils__/scripted-model.js";
import {
  DEEP_AGENT_VISION_PROFILE,
  VisionBudget,
  toLangChainImageBlocks,
  type LangChainContentBlock,
  type VisionImage,
} from "../../../shared/attachment-vision.js";

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

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.captured.push(messages);
    return super._generate(messages);
  }
}

function makeVisionImage(filename: string): VisionImage {
  const pngBytes = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(56, 0xab),
  ]);
  const outcome = new VisionBudget(DEEP_AGENT_VISION_PROFILE).offer(
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
   * `content` is exactly what setup.ts puts on the user message: a plain
   * string, or the content-block array built by toLangChainImageBlocks plus
   * the composed text block.
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

    // The EXACT input shape setup.ts constructs (plain role/content dict, not
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
      ...toLangChainImageBlocks([image]),
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
