/**
 * Download-URL hand-off for execution attachments (issue #532) — the single
 * owner of the mint policy and the prompt wording that lets an agent pass an
 * attachment to a tool whose backend cannot read the sandbox filesystem.
 *
 * Both harnesses (Cursor and deep-agent) materialize attachments to disk and
 * list the workspace paths in their input-files prompt section; that story is
 * unchanged and this module never touches it. What this module adds is the
 * *remote hand-off* story: a per-attachment download URL, minted from the
 * artifact storage the runner already downloads through, surfaced beside the
 * path so the model can quote a short URL string in a tool-call argument
 * instead of the impossible alternative (base64 through the model caps out in
 * the tens of KB; real attachments run 2–8 MB).
 *
 * Mint rule: any attachment with a `storageKey` gets a URL when the storage
 * offers presigned links (the proxy backend, {@link
 * ArtifactStorage.presignedDownloadUrl}), regardless of which branch
 * materialized the bytes — this covers the local-mode fast path when an
 * uploaded copy also exists. Local storage offers none: the runner holds none
 * of the server's signing keys, so a link it built would be refused by the
 * server's file server, and the agent's tools share the disk and read the
 * listed path. Attachments with no storage key (pure CLI-local files) and
 * extracted ZIP entries (no attachment-level object) get no URL, and their
 * listing is unchanged.
 *
 * Failure is non-fatal and silent in the prompt: the file IS materialized —
 * only the remote hand-off affordance is absent — so a presign hiccup must
 * not abort a turn the way a missing input does (the resolver/injector
 * fail-hard doctrine covers inputs, not affordances). This mirrors how vision
 * delivery degrades without killing materialization. The degrade is logged;
 * the URL value itself is never logged (a presigned URL in the log pipeline
 * would outlive its purpose).
 */

import type { ArtifactStorage } from "./artifact-storage.js";

/**
 * Mint a download URL for one attachment, or `undefined` when there is
 * nothing to mint (no key, or no storage offering presigned links) or the
 * mint fails (logged, non-fatal — see module doc). The caller spreads the result into its per-attachment
 * record with the conditional-spread convention, so an unminted URL leaves no
 * field behind.
 */
export async function mintAttachmentDownloadUrl(
  storage: ArtifactStorage | undefined,
  storageKey: string,
  filename: string,
): Promise<string | undefined> {
  if (!storageKey || storage?.presignedDownloadUrl === undefined) return undefined;
  try {
    return await storage.presignedDownloadUrl(storageKey);
  } catch (err) {
    console.warn(
      `[attachment-download-urls] could not mint a download URL for ` +
      `'${filename}' (key: ${storageKey}) — the file is materialized and the ` +
      `turn proceeds without one: ${err instanceof Error ? err.message : String(err)}`,
    );
    return undefined;
  }
}

/**
 * The shared hand-off wording both harnesses embed into their input-files
 * prompt section when at least one listed file carries a download URL (each
 * wraps it in its own section framing). Kept here so the two prompts never
 * drift apart in what they promise the agent.
 *
 * "Time-limited" is deliberately unquantified: the presign TTL belongs to the
 * serving side (the cloud proxy's constant today) and hardcoding it here would
 * silently drift.
 */
export const DOWNLOAD_URL_DISCLOSURE =
  "Where a file lists a download URL, you can pass that URL to tools " +
  "whose backends cannot read this workspace's filesystem (e.g. remote " +
  "services) — the tool fetches the file's contents itself. These URLs " +
  "are time-limited and each grants access to its single file only.";
