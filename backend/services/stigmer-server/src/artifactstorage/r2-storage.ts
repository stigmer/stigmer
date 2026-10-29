/**
 * R2 artifact storage: the Cloudflare R2 (S3-compatible) backend, over the
 * @aws-sdk client.
 *
 * Not conformance-assertable on the local targets; unit pins cover the
 * pieces that have logic: config validation copy, the 7-day presign clamp, the
 * signed Content-Disposition, the not-found mapping, and the copy's
 * source encoding.
 */
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignGetObject } from "@aws-sdk/s3-request-presigner";

import type { ArtifactStorage, PresignedUpload, SignedUrlReader } from "./artifact-storage.js";
import {
  ArtifactStorageNotFoundError,
  contentDispositionAttachment,
} from "./artifact-storage.js";
import { MAX_SIGNED_URL_TTL_MS } from "./url-signer.js";

/** R2 has a maximum presign expiration of 7 days — presigns clamp here,
 * the ceiling the local backend's signed links share (url-signer.ts). */
export const R2_MAX_EXPIRATION_MS = MAX_SIGNED_URL_TTL_MS;

/**
 * A 30s bound on the driver's network reads. The ArtifactStorage
 * interface carries no signal, so the bound lives here, on the only
 * backend where it can fire.
 */
const R2_CALL_TIMEOUT_MS = 30_000;

export interface R2StorageConfig {
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Usually "auto" for R2 (the default). */
  readonly region: string;
  /**
   * The address runners dial the store at, when it is not `endpoint`: a
   * local cluster's sandboxes reach a store on the host's loopback by
   * another name. A URL minted for a runner (a download, or an upload of
   * an output it saved) is signed for it, since a presigned URL's host is
   * part of its signature; the server's own reads and writes and a
   * person's links keep `endpoint`. Empty or absent: `endpoint` for every
   * reader.
   */
  readonly runnerEndpoint?: string;
}

/** Test seam: the AWS clients, injectable for hermetic unit tests. */
export interface R2Clients {
  readonly client: S3Client;
  /** Signs a runner's links; `client` when absent. */
  readonly runnerClient?: S3Client;
  readonly presign: typeof presignGetObject;
}

/**
 * The exported R2 driver constructor: a composition
 * registers R2-backed drivers with ITS OWN config — the cloud's verified
 * shape is distinct buckets/credentials per domain — while
 * the S3 plumbing, presign clamp, and not-found mapping live exactly once
 * here. Loud-fail: the required-config throws below fire at driver
 * construction, which the registered lazy factory defers to first use of
 * the named driver (the factory contract in drivers.ts).
 */
export function newR2ArtifactStorage(config: R2StorageConfig): ArtifactStorage {
  return new R2ArtifactStorage(config);
}

export class R2ArtifactStorage implements ArtifactStorage {
  private readonly client: S3Client;
  /** Signs a runner's links (`R2StorageConfig.runnerEndpoint`); never dialled. */
  private readonly runnerClient: S3Client;
  private readonly presign: typeof presignGetObject;
  private readonly bucket: string;

  constructor(config: R2StorageConfig, clients?: R2Clients) {
    // The required-config refusals; their copy is pinned by the tests.
    if (config.bucket === "") {
      throw new Error("R2 bucket name is required");
    }
    if (config.endpoint === "") {
      throw new Error("R2 endpoint is required");
    }
    if (config.accessKeyId === "") {
      throw new Error("R2 access key ID is required");
    }
    if (config.secretAccessKey === "") {
      throw new Error("R2 secret access key is required");
    }

    this.bucket = config.bucket;
    if (clients !== undefined) {
      this.client = clients.client;
      this.runnerClient = clients.runnerClient ?? clients.client;
      this.presign = clients.presign;
      return;
    }
    const clientFor = (endpoint: string): S3Client =>
      new S3Client({
        region: config.region === "" ? "auto" : config.region,
        endpoint,
        // R2 uses path-style addressing.
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
        },
      });
    this.client = clientFor(config.endpoint);
    const runnerEndpoint = config.runnerEndpoint ?? "";
    this.runnerClient = runnerEndpoint === "" ? this.client : clientFor(runnerEndpoint);
    this.presign = presignGetObject;
  }

  async upload(key: string, data: Uint8Array, contentType: string): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ...(contentType !== "" ? { ContentType: contentType } : {}),
        }),
      );
    } catch (error) {
      throw new Error(`r2 upload failed: ${errorText(error)}`, { cause: error });
    }
  }

  async download(key: string): Promise<Uint8Array> {
    let body: Uint8Array;
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        { abortSignal: AbortSignal.timeout(R2_CALL_TIMEOUT_MS) },
      );
      if (result.Body === undefined) {
        throw new Error("empty response body");
      }
      body = await result.Body.transformToByteArray();
    } catch (error) {
      // The typed not-found arm: consumers mapping "missing" onto
      // domain vocabulary branch on the class; every other failure stays
      // the wrapped infrastructure fault it always was. Only the log-line
      // text of the missing-object arm changes — every production caller
      // wraps download faults in a sanitized Internal before the wire.
      if (isNotFoundError(error)) {
        throw new ArtifactStorageNotFoundError(key);
      }
      throw new Error(`r2 download failed: ${errorText(error)}`, { cause: error });
    }
    return body;
  }

  async readRange(key: string, offset: number, length: number): Promise<Uint8Array> {
    if (length <= 0) {
      return new Uint8Array();
    }
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${offset}-${offset + length - 1}` }),
        { abortSignal: AbortSignal.timeout(R2_CALL_TIMEOUT_MS) },
      );
      if (result.Body === undefined) {
        throw new Error("empty response body");
      }
      return await result.Body.transformToByteArray();
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ArtifactStorageNotFoundError(key);
      }
      // A range past the end of a non-empty object: nothing left to read.
      if (isRangeNotSatisfiable(error)) {
        return new Uint8Array();
      }
      throw new Error(`r2 ranged download failed: ${errorText(error)}`, { cause: error });
    }
  }

  async size(key: string): Promise<number> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return Number(result.ContentLength ?? 0);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ArtifactStorageNotFoundError(key);
      }
      throw new Error(`r2 head failed: ${errorText(error)}`, { cause: error });
    }
  }

  async presignPut(
    key: string,
    declaredSizeBytes: number,
    ttlMs: number,
    reader: SignedUrlReader,
  ): Promise<PresignedUpload> {
    const clampedMs = Math.min(ttlMs, R2_MAX_EXPIRATION_MS);
    // The key is the caller's: the domain names its staging prefix (the
    // surface a bucket lifecycle rule sweeps) and keeps the unguessable
    // part of the URL-as-credential in the reference it hands the client.
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Signed into the URL: a PUT whose body disagrees with the declared
      // size fails the signature check — R2's arm of the exact-size
      // contract the local lane enforces by counting bytes.
      ContentLength: declaredSizeBytes,
    });
    try {
      const url = await this.presign(reader === "runner" ? this.runnerClient : this.client, command, {
        expiresIn: Math.floor(clampedMs / 1000),
      });
      return { url, ttlMs: clampedMs };
    } catch (error) {
      throw new Error(`r2 presign failed: ${errorText(error)}`, { cause: error });
    }
  }

  async getSignedUrl(
    key: string,
    expiresInMs: number,
    downloadFilename: string,
    reader: SignedUrlReader,
  ): Promise<string> {
    const clampedMs = Math.min(expiresInMs, R2_MAX_EXPIRATION_MS);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Content-Disposition is signed into the presigned URL — the browser
      // saves the object under the given name instead of rendering inline.
      ...(downloadFilename !== ""
        ? { ResponseContentDisposition: contentDispositionAttachment(downloadFilename) }
        : {}),
    });
    try {
      return await this.presign(reader === "runner" ? this.runnerClient : this.client, command, {
        expiresIn: Math.floor(clampedMs / 1000),
      });
    } catch (error) {
      throw new Error(`r2 presign failed: ${errorText(error)}`, { cause: error });
    }
  }

  // One server-side CopyObject: the bytes stay in the bucket. R2 copies an
  // object of up to 5 GB in one request, far above any File's cap.
  async copy(fromKey: string, toKey: string): Promise<void> {
    try {
      await this.client.send(
        new CopyObjectCommand({
          Bucket: this.bucket,
          Key: toKey,
          CopySource: `${this.bucket}/${encodeCopySourceKey(fromKey)}`,
        }),
      );
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new ArtifactStorageNotFoundError(fromKey);
      }
      throw new Error(`r2 copy failed: ${errorText(error)}`, { cause: error });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      throw new Error(`r2 delete failed: ${errorText(error)}`, { cause: error });
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw new Error(`r2 head failed: ${errorText(error)}`, { cause: error });
    }
  }

  async health(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      throw new Error(`r2 health check failed: ${errorText(error)}`, {
        cause: error,
      });
    }
  }
}

/**
 * Whether the error means "no such object", read from the SDK's
 * structured errors: the S3 NotFound/NoSuchKey names, an HTTP 404, or the
 * plain-text forms of the same.
 */
/** A ranged GET past the end of an object (HTTP 416, S3's InvalidRange). */
function isRangeNotSatisfiable(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const name = (error as { name?: string }).name ?? "";
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "InvalidRange" || statusCode === 416;
}

export function isNotFoundError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false;
  }
  const name = (error as { name?: string }).name ?? "";
  if (name === "NotFound" || name === "NoSuchKey") {
    return true;
  }
  const statusCode = (error as { $metadata?: { httpStatusCode?: number } })
    .$metadata?.httpStatusCode;
  if (statusCode === 404) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("404") || message.includes("not found");
}

/**
 * A key as CopySource carries it: each path segment URL-encoded, the
 * slashes kept, as the S3 API reads the header.
 */
function encodeCopySourceKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
