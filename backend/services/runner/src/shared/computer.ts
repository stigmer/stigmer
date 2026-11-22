/**
 * Whether a conversation has a computer: the one reading of
 * `SessionStatus.computer` the runner makes. Only `COMPUTER_NONE` means
 * none, so a conversation from before the setting keeps its computer.
 *
 * Read by the Stigmer engine's shell binding (no shell for the parent or any
 * subagent without one, `execute-deep-agent/turn-setup.ts`) and by the
 * phases that put a turn's skills and plugins on disk
 * (`harness/turn-context.ts`): a conversation without a computer mounts no
 * skill and no plugin tree, since nothing in it can run them, and its file
 * tools read them from the store (`archive-reader.ts`).
 */

import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

export function hasComputer(session: Session | undefined): boolean {
  return session?.status?.computer !== Computer.NONE;
}
