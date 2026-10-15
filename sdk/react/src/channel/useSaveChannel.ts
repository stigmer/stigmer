"use client";

import { useCallback, useState } from "react";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { buildChannelProto, type ChannelInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { maskedEdit } from "../internal/maskedEdit.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSaveChannel}. */
export interface UseSaveChannelReturn {
  /**
   * Apply a channel (`apply` semantics: upsert by org + slug).
   * Returns the persisted resource. A new channel that must never land on
   * a sibling's slug goes through `useCreateChannel` (strict create).
   */
  readonly save: (input: ChannelInput) => Promise<Channel>;
  /**
   * Change the fields `patch` sets on an existing channel, as loaded:
   * the update names exactly those fields, so every other field (the
   * agent reference, the type's settings, the bound vaults, the run
   * override) keeps its stored value, and a channel changed since it was
   * loaded refuses the save (ABORTED, reason `ETAG_MISMATCH`). A key set
   * to `undefined` clears that field. Returns the updated resource.
   *
   * A type's settings are named field by field: `{ web: { audience } }`
   * names `spec.web.audience` alone, so the chat link's allowed origins
   * and messages keep their stored values; `{ whatsapp: {
   * proactiveMessagingEnabled } }` names that switch and leaves the
   * number and app as stored. An empty arm (`{ slack: {} }`) names the
   * arm whole.
   *
   * Disabling is a config-preserving pause: `update(channel, { enabled:
   * false })` keeps the chat link, or the provider install and its
   * credentials. Deleting is the full teardown — see `useDeleteChannel`.
   */
  readonly update: (
    channel: Channel,
    patch: Partial<ChannelInput>,
  ) => Promise<Channel>;
  /** `true` while a save or update is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed save or update, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that applies or changes a {@link Channel} of any type.
 *
 * `save` wraps `stigmer.channel.apply()` for a new channel; `update`
 * wraps `stigmer.channel.update()` for an existing one, naming only
 * the fields its patch sets. The caller is responsible for post-save UI
 * updates (e.g. refreshing the channel list).
 *
 * @example
 * ```tsx
 * const { update, isPending } = useSaveChannel();
 *
 * const handleToggle = async (channel: Channel, enabled: boolean) => {
 *   await update(channel, { enabled });
 *   refetch(); // refresh the channel list
 * };
 * ```
 */
export function useSaveChannel(): UseSaveChannelReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const track = useCallback(async (write: () => Promise<Channel>): Promise<Channel> => {
    setIsPending(true);
    setError(null);
    try {
      return await write();
    } catch (err) {
      setError(toError(err));
      throw err;
    } finally {
      setIsPending(false);
    }
  }, []);

  const save = useCallback(
    (input: ChannelInput) => track(() => stigmer.channel.apply(input)),
    [stigmer, track],
  );

  const update = useCallback(
    (channel: Channel, patch: Partial<ChannelInput>) =>
      track(() => {
        const { resource, paths } = maskedEdit(channel, buildChannelProto, patch);
        return stigmer.channel.update(resource, typeFieldPaths(paths, patch));
      }),
    [stigmer, track],
  );

  return { save, update, isPending, error, clearError };
}

/** The `spec.type` oneof's arms, as the SDK input keys them. */
const TYPE_ARMS = ["web", "slack", "whatsapp"] as const;

/**
 * The mask paths with each type arm the patch sets narrowed to the arm's
 * fields it names (`spec.web` → `spec.web.audience`), so an edit of one
 * of a type's settings keeps the others as stored. An arm the patch sets
 * with no fields stays named whole.
 */
function typeFieldPaths(paths: readonly string[], patch: Partial<ChannelInput>): string[] {
  return paths.flatMap((path) => {
    const arm = TYPE_ARMS.find((name) => path === `spec.${name}`);
    const value = arm === undefined ? undefined : patch[arm];
    const fields = value === undefined ? [] : Object.keys(value);
    return fields.length === 0 ? [path] : fields.map((field) => `${path}.${snakeCase(field)}`);
  });
}

function snakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
