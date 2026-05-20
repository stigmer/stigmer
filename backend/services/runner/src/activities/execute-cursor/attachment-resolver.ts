/**
 * Resolves execution attachments into the platform-managed directory.
 *
 * Attachments are files provided as inputs to the agent execution.
 * In local mode, they are read directly from localPath. The files are
 * placed under .stigmer/inputs/ using the platform mount pattern.
 */

import { mkdir, copyFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { Attachment } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { getPlatformDir } from "../../shared/workspace/platform-dir.js";

const STIGMER_LOCAL_STATE_DIR = ".stigmer";
const INPUTS_SUBDIR = "inputs";

export interface ResolvedAttachment {
  filename: string;
  relativePath: string;
}

/**
 * Resolve attachments by copying them to the platform-managed directory.
 *
 * In local mode: copies from localPath to .stigmer/inputs/{filename}
 * Returns relative paths for prompt injection.
 */
export async function resolveAttachments(
  attachments: Attachment[],
  sessionId: string,
  primaryWorkspaceDir: string,
  mode: "local" | "cloud",
): Promise<ResolvedAttachment[]> {
  if (attachments.length === 0) return [];

  const platformDir = getPlatformDir(sessionId);
  const inputsDir = join(platformDir, INPUTS_SUBDIR);
  await mkdir(inputsDir, { recursive: true });

  const results: ResolvedAttachment[] = [];

  for (const attachment of attachments) {
    try {
      const resolved = await resolveAttachment(attachment, inputsDir, mode);
      if (resolved) results.push(resolved);
    } catch (err) {
      console.warn(
        `Failed to resolve attachment ${attachment.filename}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return results;
}

async function resolveAttachment(
  attachment: Attachment,
  inputsDir: string,
  mode: "local" | "cloud",
): Promise<ResolvedAttachment | null> {
  if (mode === "local" && attachment.localPath) {
    const filename = attachment.filename || basename(attachment.localPath);
    const destPath = join(inputsDir, filename);
    await copyFile(attachment.localPath, destPath);

    return {
      filename,
      relativePath: join(STIGMER_LOCAL_STATE_DIR, INPUTS_SUBDIR, filename),
    };
  }

  // Cloud mode: download from storage_key (not yet implemented for cursor-runner)
  console.warn(
    `Attachment ${attachment.filename}: cloud storage download not yet implemented for cursor-runner`,
  );
  return null;
}

