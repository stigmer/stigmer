/**
 * The memory kind's shared reads, all through the list index (list-index.ts
 * beside this file; the store's contract in store/interface.ts): recall
 * (domain/agentexecution/create-steps.ts) and the per-subject cap read one
 * subject's rows in one organization, `memory.list` reads one
 * organization's. Rows come newest created first, the index order, which
 * is exactly `compareCreatedAtDesc` (store/list-index.ts states it).
 *
 * Every row is re-checked against the organization and the subject it was
 * asked for, whatever the index returned, as the IamPolicy adapter
 * re-checks its principal (domain/iampolicy/resource-store.ts): it keeps
 * the "" subject exact, which reads the whole organization because an
 * empty value is no key. Undecodable rows are skipped — one bad record
 * must not take recall, the cap or the list down. A store fault is
 * thrown as it came; each caller maps it with its own copy.
 *
 * Proven by __tests__/queries.test.ts and, end to end, by
 * memory.conformance.test.ts.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";

import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";
import { memoryListIndex } from "./list-index.js";

/**
 * Every memory `subject` holds in `org`, in every lifecycle state — the
 * run's person's account id, or the single-operator "" sentinel.
 */
export async function listSubjectMemories(
  store: Store,
  org: string,
  subject: string,
): Promise<Memory[]> {
  const rows = await store.queryResources(memoryListIndex, {
    org,
    ...(subject === ""
      ? {}
      : { anyKey: [{ name: "subject" as const, value: subject }] }),
  });
  return decodeMemories(rows).filter(
    (memory) =>
      (memory.metadata?.org ?? "") === org &&
      (memory.spec?.subjectIdentityAccountId ?? "") === subject,
  );
}

/** Every memory in `org`, whoever it is about. */
export async function listOrganizationMemories(
  store: Store,
  org: string,
): Promise<Memory[]> {
  const rows = await store.queryResources(memoryListIndex, { org });
  return decodeMemories(rows).filter(
    (memory) => (memory.metadata?.org ?? "") === org,
  );
}

function decodeMemories(rows: ReadonlyArray<ListIndexRow>): Memory[] {
  const memories: Memory[] = [];
  for (const row of rows) {
    try {
      memories.push(fromBinary(MemorySchema, row.data));
    } catch {
      continue;
    }
  }
  return memories;
}
