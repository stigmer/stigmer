/**
 * The Stigmer harness's images at the model call: the thread holds a
 * pointer to each image a person attached, and this middleware sends the
 * image's bytes in the pointer's place, on the one request, never in state
 * (stigmer/stigmer#3087; the pointer's shape and why are
 * `shared/attachment-vision.ts`'s, the read is `shared/file-mount.ts`'s).
 *
 *   - `wrapModelCall` rewrites the request's messages only: each user
 *     message holding a pointer is copied with every pointer replaced by
 *     the inline `image_url` block of its File's bytes, read from the
 *     session's mount by File id, sniffed again and held to the per-image
 *     cap. The checkpoint, the summarizer (which renders an image as a
 *     word) and a continuation all keep the pointer.
 *   - A pointer whose File the mount no longer holds (the conversation
 *     dropped it) becomes {@link IMAGE_REMOVED_TEXT}, after the label block
 *     that still names it, and the turn goes on: a removed File stops
 *     being shown.
 *   - A thread saved before pointers holds data URLs; they are sent as
 *     they are.
 *
 * Every image a call could name is on disk when the call is made: a turn
 * mounts the conversation's Files before its graph runs, and a message sent
 * while it works mounts its Files when the turn claims it.
 *
 * Placement: last of Stigmer's middlewares (`turn-setup.ts`), so it is the
 * innermost of them and every other wrapper sees the thread's own shape;
 * deepagents' tail (prompt caching among it) runs after it and marks the
 * request that carries the bytes.
 *
 * Memory over reads: one instance per graph, made with the turn's engine
 * and dropped with it. It holds each image once, by File id (a File's
 * bytes never change), so a turn's later calls and retries read nothing; a
 * miss is not held, so a File mounted later in the turn is still found.
 *
 * Proven by __tests__/vision-input.test.ts (through the real
 * `createDeepAgent` stack and its checkpointers) and
 * __tests__/image-ref-middleware.test.ts.
 */

import { HumanMessage, type BaseMessage, type MessageContent } from "@langchain/core/messages";
import { createMiddleware } from "langchain";

import {
  imageRefOf,
  MAX_VISION_IMAGE_BYTES,
  sniffImageMime,
  toLangChainImageBlock,
  type LangChainImageBlock,
} from "../../shared/attachment-vision.js";
import { readMountedFile } from "../../shared/file-mount.js";

/** What the model reads where an image whose File the conversation dropped was. */
export const IMAGE_REMOVED_TEXT = "(This image was removed from the conversation.)";

/** What the middleware reads images from. */
export interface ImageRefOptions {
  readonly sessionId: string;
}

/** The middleware (module header). */
export function createImageRefMiddleware(options: ImageRefOptions) {
  const held = new Map<string, LangChainImageBlock>();

  async function inlineOf(fileId: string): Promise<LangChainImageBlock | undefined> {
    const known = held.get(fileId);
    if (known !== undefined) return known;
    const bytes = await readMountedFile(options.sessionId, fileId);
    const mimeType = bytes === undefined ? undefined : sniffImageMime(bytes);
    if (bytes === undefined || mimeType === undefined || bytes.length > MAX_VISION_IMAGE_BYTES) {
      console.warn(`[image-refs] session=${options.sessionId} file=${fileId} is not on the mount; the model reads that it was removed`);
      return undefined;
    }
    const block = toLangChainImageBlock({ mimeType, base64: bytes.toString("base64") });
    held.set(fileId, block);
    return block;
  }

  async function inlined(message: BaseMessage): Promise<BaseMessage> {
    if (!HumanMessage.isInstance(message) || !Array.isArray(message.content)) return message;
    if (!message.content.some((block) => imageRefOf(block) !== undefined)) return message;
    const content = await Promise.all(
      message.content.map(async (block) => {
        const fileId = imageRefOf(block);
        if (fileId === undefined) return block;
        return (await inlineOf(fileId)) ?? { type: "text" as const, text: IMAGE_REMOVED_TEXT };
      }),
    );
    return new HumanMessage({
      content: content as MessageContent,
      id: message.id,
      name: message.name,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  return createMiddleware({
    name: "StigmerImageRefs",
    wrapModelCall: async (request, handler) =>
      handler({ ...request, messages: await Promise.all(request.messages.map(inlined)) }),
  });
}
