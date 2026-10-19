/**
 * Pins that no field a person or a client writes holds a storage key: the
 * contract walks every message reachable from Run, Session and Routine
 * (so RunSpec, SessionSpec and AgentInvocation) and from every File
 * message, and finds a key-holding field only where it is named here.
 *
 * Two are named, each kept on purpose:
 *   - RunArtifact.storage_key, under RunStatus.artifacts: what the agent
 *     wrote back, still addressed by key until outputs become Files;
 *   - ToolCallOutputRef.storage_key, the offload and file-review reference,
 *     which a client only reads back and resolves through the run.
 *
 * A signed link carries its key inside its URL; a url field is not a
 * key-holding field, because nothing accepts it back as an address.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import * as fileApi from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import * as fileIo from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import * as fileMount from "@stigmer/apis/ai/stigmer/agentic/file/v1/mount_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";

/** A field name that says it holds where bytes are stored. */
const KEY_FIELD = /(^|_)(storage|blob|object)_key$/;

/** The key-holding fields kept on purpose (module header). */
const KEPT = ["ai.stigmer.agentic.run.v1.RunArtifact.storage_key", "ai.stigmer.agentic.run.v1.ToolCallOutputRef.storage_key"];

function messagesOf(module: Record<string, unknown>): DescMessage[] {
  return Object.values(module).filter(
    (value): value is DescMessage => typeof value === "object" && value !== null && (value as DescMessage).kind === "message",
  );
}

/** Every key-holding field reachable from the roots, by its full name. */
function keyFields(roots: readonly DescMessage[]): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const walk = (message: DescMessage): void => {
    if (seen.has(message.typeName)) {
      return;
    }
    seen.add(message.typeName);
    for (const field of message.fields) {
      if (KEY_FIELD.test(field.name)) {
        found.add(`${message.typeName}.${field.name}`);
      }
      const nested =
        field.fieldKind === "message"
          ? field.message
          : (field.fieldKind === "list" || field.fieldKind === "map") && field.message !== undefined
            ? field.message
            : undefined;
      if (nested !== undefined) {
        walk(nested);
      }
    }
  };
  roots.forEach(walk);
  return [...found].sort();
}

describe("no field a client writes holds a storage key", () => {
  it("finds key-holding fields only where they are kept on purpose", () => {
    const roots = [RunSchema, SessionSchema, RoutineSchema, ...messagesOf(fileApi), ...messagesOf(fileIo), ...messagesOf(fileMount)];
    expect(keyFields(roots)).toEqual([...KEPT].sort());
  });

  it("would find one: the walk reaches a nested key-holding field", () => {
    expect(keyFields([RunSchema])).toContain("ai.stigmer.agentic.run.v1.RunArtifact.storage_key");
  });
});
