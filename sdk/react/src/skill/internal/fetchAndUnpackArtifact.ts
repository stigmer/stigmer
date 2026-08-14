import { create } from "@bufbuild/protobuf";
import { GetArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { isUnimplemented, type Stigmer } from "@stigmer/sdk";
import type { SkillFileEntry } from "../useSkillUpload.js";

/** Unpacked artifact: file entries for browsing + content map for reading. */
export interface UnpackedArtifact {
  readonly files: SkillFileEntry[];
  readonly contentMap: ReadonlyMap<string, string>;
}

/**
 * Fetch a skill artifact by storage key, unzip it, and return the file listing
 * with a content map. Shared by `useSkillArtifact` (single-version browser)
 * and `useSkillDiff` (two-version comparison).
 *
 * Throws on network or decompression errors — callers handle error state.
 */
export async function fetchAndUnpackArtifact(
  stigmer: Stigmer,
  artifactStorageKey: string,
): Promise<UnpackedArtifact> {
  const artifact = await fetchArtifactBytes(stigmer, artifactStorageKey);

  const { unzipSync, strFromU8 } = await import("fflate");
  const unzipped = unzipSync(artifact);

  const entries = Object.entries(unzipped);
  const files: SkillFileEntry[] = entries.map(([path, data]) => ({
    path,
    size: data.length,
    isDirectory: data.length === 0 && path.endsWith("/"),
  }));

  // Every non-directory entry gets a map entry — including zero-byte files,
  // which map to "". Skipping them would make an empty file unreadable in the
  // browser and read as *deleted* (rather than emptied) in version diffs.
  const contentMap = new Map<string, string>();
  for (const [path, data] of entries) {
    if (!path.endsWith("/")) {
      try {
        contentMap.set(path, strFromU8(data));
      } catch {
        contentMap.set(path, "[Binary content]");
      }
    }
  }

  return { files, contentMap };
}

/**
 * Fetch the artifact ZIP bytes, URL-first (the transfer lane, stigmer#675):
 * the bytes ride HTTP, so any valid skill (up to the 100MB limit) is
 * fetchable — the unary `getArtifact` RPC is capped at the server's 10MB
 * gRPC message limit.
 *
 * Fallbacks to the unary lane, deliberately wider than the runner's
 * mint-Unimplemented-only contract because this code runs in a browser:
 *
 * - `Unimplemented` from the mint — a pre-transfer-lane server (the code
 *   clients key their fallback on, same as every other lane client).
 * - A failed HTTP fetch of the minted URL — in a browser this is how a
 *   missing bucket CORS policy surfaces (an opaque `TypeError`,
 *   indistinguishable from a network failure). The unary lane was the
 *   status quo and still serves everything under the message cap, so
 *   degrading beats breaking the console; the warn keeps it observable.
 */
async function fetchArtifactBytes(
  stigmer: Stigmer,
  artifactStorageKey: string,
): Promise<Uint8Array> {
  const request = create(GetArtifactRequestSchema, { artifactStorageKey });

  let minted;
  try {
    minted = await stigmer.skill.getArtifactDownloadUrl(request);
  } catch (err) {
    if (isUnimplemented(err)) {
      const response = await stigmer.skill.getArtifact(request);
      return response.artifact;
    }
    throw err;
  }

  try {
    const doFetch = stigmer.fetch ?? globalThis.fetch;
    const resp = await doFetch(minted.url);
    if (!resp.ok) {
      throw new Error(`artifact download failed with HTTP ${resp.status}`);
    }
    return new Uint8Array(await resp.arrayBuffer());
  } catch (err) {
    console.warn(
      "[stigmer] skill artifact download URL fetch failed (bucket CORS not provisioned for this origin?) — falling back to the unary lane",
      err,
    );
    const response = await stigmer.skill.getArtifact(request);
    return response.artifact;
  }
}
