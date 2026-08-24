/**
 * R2 artifact storage — ports pkg/domain/artifact/storage/r2_storage.go:
 * the Cloudflare R2 (S3-compatible) backend, filling the factory arm #17
 * deferred to this sub-project (owner-ratified, approved at the #13 plan
 * gate together with the @aws-sdk dependency).
 *
 * Not conformance-assertable on the local targets (same as Go — the Go
 * tree carries no R2 tests at all); the port adds unit pins for the pieces
 * that have logic: config validation copy, the 7-day presign clamp, the
 * signed Content-Disposition, and the not-found mapping.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignGetObject } from "@aws-sdk/s3-request-presigner";

import type { ArtifactStorage } from "./artifact-storage.js";
import { contentDispositionAttachment } from "./artifact-storage.js";

/** Go: "R2 has a maximum expiration of 7 days" — presigns clamp here. */
export const R2_MAX_EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Go get_content/get_download_url wrap their storage calls in a 30s
 * context timeout. The TS ArtifactStorage interface carries no signal, so
 * the same bound lives one layer down, on the driver's network reads —
 * identical ceiling, applied at the only backend where it can fire.
 */
const R2_CALL_TIMEOUT_MS = 30_000;

export interface R2StorageConfig {
  readonly bucket: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Usually "auto" for R2 (Go default). */
  readonly region: string;
}

/** Test seam: the two AWS clients, injectable for hermetic unit tests. */
export interface R2Clients {
  readonly client: S3Client;
  readonly presign: typeof presignGetObject;
}

export class R2ArtifactStorage implements ArtifactStorage {
  private readonly client: S3Client;
  private readonly presign: typeof presignGetObject;
  private readonly bucket: string;

  constructor(config: R2StorageConfig, clients?: R2Clients) {
    // Go NewR2Storage's required-config errors, byte-mirrored.
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
      this.presign = clients.presign;
      return;
    }
    this.client = new S3Client({
      region: config.region === "" ? "auto" : config.region,
      endpoint: config.endpoint,
      // R2 uses path-style addressing (Go o.UsePathStyle = true).
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
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
      throw new Error(`r2 download failed: ${errorText(error)}`, { cause: error });
    }
    return body;
  }

  async getSignedUrl(
    key: string,
    expiresInMs: number,
    downloadFilename: string,
  ): Promise<string> {
    const clampedMs = Math.min(expiresInMs, R2_MAX_EXPIRATION_MS);
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      // Go signs Content-Disposition into the presigned URL — the browser
      // saves the object under the given name instead of rendering inline.
      ...(downloadFilename !== ""
        ? { ResponseContentDisposition: contentDispositionAttachment(downloadFilename) }
        : {}),
    });
    try {
      return await this.presign(this.client, command, {
        expiresIn: Math.floor(clampedMs / 1000),
      });
    } catch (error) {
      throw new Error(`r2 presign failed: ${errorText(error)}`, { cause: error });
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
 * Whether the error means "no such object" (Go isNotFoundError, adapted to
 * the SDK's structured errors instead of Go's string matching): the S3
 * NotFound/NoSuchKey names, an HTTP 404, or the legacy text forms.
 */
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
