/**
 * Pins the model-call half of the deep agent's image pointers
 * (../image-ref-middleware.ts), called directly: each pointer in a user
 * message becomes its File's inline block on the request handed on, the
 * request's other messages and blocks are handed on as they are (an
 * assistant's or a tool's text that quotes a pointer, a thread saved
 * before pointers with its data URL); a File the mount does not hold, or
 * whose bytes are no longer an image the cap admits, becomes the removed
 * line; a hit is held for the graph's later calls and a miss is not, so a
 * File mounted later is still found. The end-to-end proof through
 * `createDeepAgent` and both checkpointers is vision-input.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import * as fileMount from "../../../shared/file-mount.js";
import { imageRefText, MAX_VISION_IMAGE_BYTES } from "../../../shared/attachment-vision.js";
import { IMAGE_REMOVED_TEXT, createImageRefMiddleware } from "../image-ref-middleware.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PNG_BLOCK = { type: "image_url", image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } };
const SESSION = "ses_refs_unit";

type Request = { readonly messages: BaseMessage[] };
type WrapModelCall = (request: Request, handler: (request: Request) => Promise<Request>) => Promise<Request>;

/** The middleware's model-call wrapper, handing back the request it passed on. */
function wrapperOf(): (messages: BaseMessage[]) => Promise<BaseMessage[]> {
  const wrap = (createImageRefMiddleware({ sessionId: SESSION }) as unknown as { wrapModelCall: WrapModelCall }).wrapModelCall;
  return async (messages) => (await wrap({ messages }, async (request) => request)).messages;
}

function pointerMessage(fileId: string, text = "what is this?"): HumanMessage {
  return new HumanMessage({
    id: "h1",
    content: [
      { type: "text", text: "Image 1: shot.png" },
      { type: "text", text: imageRefText(fileId) },
      { type: "text", text },
    ],
  });
}

let root: string;
let originalHome: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "image-refs-"));
  originalHome = process.env.HOME;
  process.env.HOME = root;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("createImageRefMiddleware", () => {
  it("sends each pointer as its File's inline block, keeping the message's id, label and text", async () => {
    vi.spyOn(fileMount, "readMountedFile").mockResolvedValue(PNG);
    const [sent] = await wrapperOf()([pointerMessage("file_shot")]);
    expect(HumanMessage.isInstance(sent!)).toBe(true);
    expect(sent!.id).toBe("h1");
    expect(sent!.content).toEqual([{ type: "text", text: "Image 1: shot.png" }, PNG_BLOCK, { type: "text", text: "what is this?" }]);
  });

  it("hands on every other message and block as it is", async () => {
    const read = vi.spyOn(fileMount, "readMountedFile").mockResolvedValue(PNG);
    const legacy = new HumanMessage({ content: [{ type: "text", text: "Image 1: old.png" }, PNG_BLOCK, { type: "text", text: "old" }] });
    const quoting = [
      new AIMessage({ content: imageRefText("file_shot") }),
      new ToolMessage({ content: [{ type: "text", text: imageRefText("file_shot") }], tool_call_id: "call_1" }),
      new HumanMessage({ content: `see ${imageRefText("file_shot")}` }),
      legacy,
    ];
    const sent = await wrapperOf()(quoting);
    sent.forEach((message, i) => expect(message).toBe(quoting[i]));
    expect(read).not.toHaveBeenCalled();
  });

  it("shows the removed line for a File the mount does not hold, or whose bytes the cap or the sniff refuse", async () => {
    vi.spyOn(fileMount, "readMountedFile").mockImplementation(async (_session, fileId) => {
      if (fileId === "file_text") return Buffer.from("not an image");
      if (fileId === "file_huge") return Buffer.concat([PNG, Buffer.alloc(MAX_VISION_IMAGE_BYTES)]);
      return undefined;
    });
    for (const fileId of ["file_gone", "file_text", "file_huge"]) {
      const [sent] = await wrapperOf()([pointerMessage(fileId)]);
      expect(sent!.content, fileId).toEqual([
        { type: "text", text: "Image 1: shot.png" },
        { type: "text", text: IMAGE_REMOVED_TEXT },
        { type: "text", text: "what is this?" },
      ]);
    }
  });

  it("holds a File it found for the graph's later calls, and asks again for one it did not", async () => {
    const read = vi.spyOn(fileMount, "readMountedFile").mockResolvedValueOnce(undefined).mockResolvedValue(PNG);
    const call = wrapperOf();
    const [missed] = await call([pointerMessage("file_late")]);
    expect((missed!.content as unknown[])[1]).toEqual({ type: "text", text: IMAGE_REMOVED_TEXT });
    for (let i = 0; i < 3; i += 1) {
      const [sent] = await call([pointerMessage("file_late")]);
      expect((sent!.content as unknown[])[1]).toEqual(PNG_BLOCK);
    }
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledWith(SESSION, "file_late");
  });
});
