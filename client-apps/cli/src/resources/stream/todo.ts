// Todo-list change detection for the snapshot differ.
//
// Ports the Go CLI's emitTodoEvents + fingerprint helpers
// (run_stream_events.go:786-847). Each snapshot carries the full todo map; this
// differ compares a lightweight {content,status} fingerprint per item and emits
// a single TodoUpdateEvent (with the full list) whenever anything is added,
// removed, or changed.

import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { convertProtoTodos, mapTodoStatus } from "./convert.js";
import type { StreamEvent } from "./events.js";

interface Fingerprint {
  readonly content: string;
  readonly status: string;
}

/** Stateful todo differ: holds the last fingerprint snapshot across calls. */
export class TodoDiffer {
  private prev = new Map<string, Fingerprint>();

  /** True once any todo has been recorded, until the list is emptied. Mirrors Go's `len(prevTodos) > 0` guard. */
  get hasPrev(): boolean {
    return this.prev.size > 0;
  }

  /** Diff the current todo map and return a TodoUpdateEvent when it changed. */
  diff(todos: Record<string, TodoItem>): StreamEvent[] {
    const current = buildFingerprints(todos);
    if (!changed(this.prev, current)) return [];
    this.prev = current;
    return [{ kind: "todoUpdate", todos: convertProtoTodos(todos) }];
  }
}

function buildFingerprints(todos: Record<string, TodoItem>): Map<string, Fingerprint> {
  const fp = new Map<string, Fingerprint>();
  for (const [id, item] of Object.entries(todos)) {
    fp.set(id, { content: item.content, status: mapTodoStatus(item.status) });
  }
  return fp;
}

// True if the maps differ in size or any key's value. Detects add/remove/edit.
// Mirrors Go's todoFingerprintsChanged.
function changed(prev: Map<string, Fingerprint>, current: Map<string, Fingerprint>): boolean {
  if (prev.size !== current.size) return true;
  for (const [k, v] of current) {
    const p = prev.get(k);
    if (p === undefined || p.content !== v.content || p.status !== v.status) return true;
  }
  return false;
}
