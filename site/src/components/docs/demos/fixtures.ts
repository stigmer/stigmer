/**
 * Fixtures the inline docs demos share: the demo organization, the My
 * vault answers the sign-in demos give (nothing saved, a key by name, a
 * login at an address; every value blanked as a real read blanks it), an
 * empty workspace, and a conversation builder that folds a turn's session
 * events. All of it is data; nothing here renders.
 */
import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import type { UseWorkspaceEntriesReturn } from "@stigmer/react";
import { samples } from "@stigmer/react/test";
import type { Turn } from "@stigmer/sdk";

export const DEMO_ORG = "demo-org";

/**
 * My vault with nothing saved yet, the answer the sign-in demos give to the
 * console's My vault read: the views they replay offer to sign in or paste a
 * token, and no saved value ever appears.
 */
export function emptyMyVault(): Vault {
  return create(VaultSchema, {});
}

/**
 * My vault holding one secret by name and nothing else, as every read
 * answers it: the value blanked, only the name and what it is for. The
 * answer a demo gives when the server it replays reads a key the reader
 * already saved, so a tools check reaches the server as the person looking.
 */
export function myVaultHolding(name: string, description: string): Vault {
  return create(VaultSchema, {
    spec: { secrets: { [name]: { value: "", description } } },
  });
}

/**
 * My vault holding one login, saved by a sign-in at a server's address,
 * the token blanked as every read is: the answer a demo gives once its
 * sign-in has landed, so the server's row says "Signed in".
 */
export function myVaultSignedInAt(address: string, description: string): Vault {
  return create(VaultSchema, {
    spec: {
      connections: {
        [address]: { token: "", source: VaultConnectionSource.sign_in, description },
      },
    },
  });
}

const noop = () => {};

export const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  clearLocal: noop,
  toInput: () => [],
  hasEntries: false,
};

/**
 * A depicted conversation as the session surface reads it: its turns (the
 * session's events folded) and the runs beside them. `MessageThread`
 * renders the turns; the run carries what the events do not (the phase the
 * widget sidebar's badge reads).
 */
export interface DemoConversation {
  readonly turns: readonly Turn[];
  readonly runs: readonly Run[];
}

/**
 * Fold one turn's session events (built with the `samples.*Event`
 * builders, all on the demo run) into a {@link DemoConversation}, beside
 * the demo run at `phase` started with the turn's own message, so the run
 * and the events never disagree on what the person asked.
 *
 * Pass the phase the events end on: `RUN_IN_PROGRESS` (the default) for a
 * mid-conversation frame, `RUN_COMPLETED` for a finished one. Nothing is
 * fetched; the phase is presentational.
 */
export function conversation(
  events: readonly SessionEvent[],
  phase: RunPhase = RunPhase.RUN_IN_PROGRESS,
): DemoConversation {
  const fold = samples.fold(events);
  return {
    turns: fold.turns,
    runs: [samples.run({ phase, message: fold.turns[0]?.userMessage?.text ?? "" })],
  };
}
