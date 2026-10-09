/**
 * Test support: the bytes an earlier release wrote for a session whose
 * spec held a conversation's own secrets (SessionSpec field 16) and
 * connections (field 17), both map<string, string>, built by wire number
 * because the current schema reserves them. Shared by the module's unit
 * test and both drivers' migration tests, so every one reads the same old
 * shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";

/** Session field 4 holds the spec, field 5 the status. */
const SESSION_SPEC_FIELD = 4;
const SESSION_STATUS_FIELD = 5;

/** What a session row held beside its current fields. */
export interface RetiredSessionValues {
  readonly secrets?: Readonly<Record<string, string>>;
  readonly connections?: Readonly<Record<string, string>>;
  /** A field no release defined, which the step must keep as it is. */
  readonly foreign?: { readonly no: number; readonly value: string };
}

/** The current bytes of a session: what the release writes for it. */
export function currentSessionRow(init: MessageInitShape<typeof SessionSchema>): Uint8Array {
  return toBinary(SessionSchema, create(SessionSchema, init));
}

/** One map<string, string> field's entries, each written as its own tagged entry. */
function writeMap(w: BinaryWriter, no: number, entries: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(entries)) {
    w.tag(no, WireType.LengthDelimited).fork();
    w.tag(1, WireType.LengthDelimited).string(key);
    w.tag(2, WireType.LengthDelimited).string(value);
    w.join();
  }
}

/**
 * A session row as an earlier release wrote it, fields in number order:
 * `init`'s fields, and the retired fields (and any foreign one) appended
 * to its spec.
 */
export function sessionRowWithValues(
  init: MessageInitShape<typeof SessionSchema>,
  retired: RetiredSessionValues,
): Uint8Array {
  const session = create(SessionSchema, init);
  const spec = session.spec ?? create(SessionSpecSchema);
  const status = session.status;
  session.spec = undefined;
  session.status = undefined;

  const specWriter = new BinaryWriter();
  specWriter.raw(toBinary(SessionSpecSchema, spec));
  writeMap(specWriter, 16, retired.secrets ?? {});
  writeMap(specWriter, 17, retired.connections ?? {});
  if (retired.foreign !== undefined) {
    specWriter.tag(retired.foreign.no, WireType.LengthDelimited).string(retired.foreign.value);
  }

  const w = new BinaryWriter();
  w.raw(toBinary(SessionSchema, session));
  w.tag(SESSION_SPEC_FIELD, WireType.LengthDelimited).bytes(specWriter.finish());
  if (status !== undefined) {
    w.tag(SESSION_STATUS_FIELD, WireType.LengthDelimited).bytes(toBinary(SessionStatusSchema, status));
  }
  return w.finish();
}
