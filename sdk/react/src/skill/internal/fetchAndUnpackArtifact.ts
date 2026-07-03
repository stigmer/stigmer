import { create } from "@bufbuild/protobuf";
import { GetArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
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
  const request = create(GetArtifactRequestSchema, { artifactStorageKey });
  const response = await stigmer.skill.getArtifact(request);

  const { unzipSync, strFromU8 } = await import("fflate");
  const unzipped = unzipSync(response.artifact);

  const entries = Object.entries(unzipped);
  const files: SkillFileEntry[] = entries.map(([path, data]) => ({
    path,
    size: data.length,
    isDirectory: data.length === 0 && path.endsWith("/"),
  }));

  const contentMap = new Map<string, string>();
  for (const [path, data] of entries) {
    if (!path.endsWith("/") && data.length > 0) {
      try {
        contentMap.set(path, strFromU8(data));
      } catch {
        contentMap.set(path, "[Binary content]");
      }
    }
  }

  return { files, contentMap };
}
