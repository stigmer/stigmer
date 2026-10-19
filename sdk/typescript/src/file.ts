/**
 * File client with size-routed uploads: the File kind's binding of the
 * transfer lane skills already push over (`artifact-routing.ts`). The
 * transport caps a whole request at 10 MiB, so a file that fits under the
 * skills' inline threshold travels in the `upload` request itself, and a
 * larger one is PUT to the short-lived URL `createUploadUrl` mints and then
 * uploaded by its reference. Callers hand over the content and get the File
 * back; which way the bytes went is not their concern.
 *
 * Trade-offs:
 * - A `Blob` (a browser `File`, or Node's file-backed `openAsBlob`, which
 *   `uploadFileFromPath` in `node.ts` uses) is the PUT body as it is, so
 *   fetch streams it from its backing store and sets its exact length. Only
 *   a Blob small enough to travel inline is read, because the inline
 *   request carries the bytes themselves.
 * - The PUT carries no Authorization header: the URL is the credential. For
 *   the same reason no error names it, since a bucket's URL holds its
 *   signature in the query and the server's own lane holds its token in the
 *   path. A bucket's XML rejection is cut down to its Code and Message, the
 *   parts that never restate the signed request.
 *
 * Every generated method is inherited; `upload` itself also routes, so a
 * caller that builds the request with large inline data is staged instead
 * of refused by the transport.
 */
import { create } from "@bufbuild/protobuf";
import { Code, type Transport } from "@connectrpc/connect";
import type { File } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  CreateFileUploadUrlInputSchema,
  UploadFileInputSchema,
  type UploadFileInput,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { MAX_INLINE_ARTIFACT_BYTES } from "./artifact-routing.js";
import { StigmerError } from "./gen/errors.js";
import { FileClient } from "./gen/file.js";

/**
 * A file's bytes: in memory, or a `Blob` that is streamed when it is too
 * large to travel inline.
 */
export type FileContent = Uint8Array | Blob;

/** What {@link RoutedFileClient.uploadFile} uploads, and where to. */
export interface UploadFileOptions {
  /** Organization the File belongs to, by id or slug; with `sessionId`, the conversation's. */
  readonly org: string;
  /** The conversation to upload the File into. Omitted uploads a File of your own. */
  readonly sessionId?: string;
  /** The file's name: at most 255 characters, no `/`, `\` or control characters. */
  readonly filename: string;
  /** The media type ("image/png"). Omitted, the server takes it from the filename's extension. */
  readonly mimeType?: string;
  readonly content: FileContent;
}

interface UploadTarget {
  readonly org: string;
  readonly sessionId: string;
  readonly filename: string;
  readonly mimeType: string;
}

export class RoutedFileClient extends FileClient {
  private readonly fetchImpl: typeof globalThis.fetch | undefined;

  /**
   * @param fetchImpl - Custom `fetch` for the staging PUT. Must be the same
   *   implementation the transport uses where the global one is restricted
   *   (the Tauri CSP/CORS case the `Stigmer.fetch` property documents).
   */
  constructor(transport: Transport, fetchImpl?: typeof globalThis.fetch) {
    super(transport);
    this.fetchImpl = fetchImpl;
  }

  /**
   * Upload a File from a built request. Inline data above the threshold is
   * staged and uploaded by reference; a request that already names an
   * upload reference is sent as it is.
   */
  override upload(input: UploadFileInput): Promise<File> {
    if (input.source.case === "data" && input.source.value.byteLength > MAX_INLINE_ARTIFACT_BYTES) {
      return this.uploadStaged(input, input.source.value, input.source.value.byteLength);
    }
    return super.upload(input);
  }

  /** Upload a File, routing its content by size (see the module comment). */
  async uploadFile(options: UploadFileOptions): Promise<File> {
    const target: UploadTarget = {
      org: options.org,
      sessionId: options.sessionId ?? "",
      filename: options.filename,
      mimeType: options.mimeType ?? "",
    };
    const { content } = options;
    const size = content instanceof Uint8Array ? content.byteLength : content.size;
    if (size > MAX_INLINE_ARTIFACT_BYTES) {
      return this.uploadStaged(target, content, size);
    }
    const data = content instanceof Uint8Array ? content : new Uint8Array(await content.arrayBuffer());
    return super.upload(create(UploadFileInputSchema, { ...target, source: { case: "data", value: data } }));
  }

  /** createUploadUrl, PUT the bytes, then upload by the returned reference. */
  private async uploadStaged(target: UploadTarget, content: FileContent, size: number): Promise<File> {
    const minted = await super.createUploadUrl(
      create(CreateFileUploadUrlInputSchema, {
        org: target.org,
        sessionId: target.sessionId,
        sizeBytes: BigInt(size),
      }),
    );
    await putToUploadUrl(minted.url, content, this.fetchImpl);
    return super.upload(
      create(UploadFileInputSchema, {
        org: target.org,
        sessionId: target.sessionId,
        filename: target.filename,
        mimeType: target.mimeType,
        source: { case: "uploadRef", value: minted.uploadRef },
      }),
    );
  }
}

/** PUT the bytes to the upload URL, with no auth header and no URL in any error. */
async function putToUploadUrl(
  url: string,
  content: FileContent,
  fetchImpl: typeof globalThis.fetch | undefined,
): Promise<void> {
  const doFetch = fetchImpl ?? globalThis.fetch;
  let resp: Response;
  try {
    resp = await doFetch(url, {
      method: "PUT",
      // Both DOM and undici accept a Blob or an ArrayBufferView and derive
      // Content-Length from it; the cast bridges TS 5.7's ArrayBufferLike
      // generic, which BodyInit's typing predates.
      body: content as unknown as RequestInit["body"],
      headers: { "content-type": "application/octet-stream" },
    });
  } catch (err) {
    throw new StigmerError("unavailable", "file upload failed: the upload URL could not be reached", Code.Unavailable, {
      cause: err,
    });
  }
  if (!resp.ok) {
    const detail = redactUrl(rejectionDetail(await resp.text().catch(() => "")), url);
    throw new StigmerError(
      "unknown",
      `file upload rejected with HTTP ${resp.status}${detail === "" ? "" : `: ${detail}`}`,
      Code.Unknown,
    );
  }
}

const MAX_DETAIL_CHARS = 512;

/**
 * The part of a rejection body worth showing. A bucket answers XML whose
 * other elements can restate the signed request, so only its Code and
 * Message are kept; the server's own lane answers plain text.
 */
function rejectionDetail(body: string): string {
  const text = body.trim();
  if (!text.startsWith("<")) return text.slice(0, MAX_DETAIL_CHARS);
  const element = (name: string): string =>
    new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1]?.trim() ?? "";
  return [element("Code"), element("Message")]
    .filter((part) => part !== "")
    .join(": ")
    .slice(0, MAX_DETAIL_CHARS);
}

/** Remove the URL, and its query on its own, from text that echoes either. */
function redactUrl(text: string, url: string): string {
  const queryStart = url.indexOf("?");
  const secrets = [url, queryStart >= 0 ? url.slice(queryStart + 1) : ""].filter((s) => s !== "");
  return secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}
