/**
 * Reading a retired field off a stored row by its wire number. A data
 * migration that lifts a field the contract removed cannot read it through
 * a schema, because none holds it any more: the decoder keeps it in the
 * message's unknown fields, and these helpers read and drop it there. They
 * are shared by every lift that does so (workspace-becomes-resources.ts,
 * run-artifacts-become-files.ts), so the wire reading is written once.
 *
 * Pinned through those lifts' tests.
 */
import type { UnknownField } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";

/** Calls `visit` for each field of `bytes`, skipping those it does not take. */
export function eachField(
  bytes: Uint8Array,
  visit: (no: number, wireType: WireType, reader: BinaryReader) => boolean,
): void {
  const reader = new BinaryReader(bytes);
  while (reader.pos < reader.len) {
    const [no, wireType] = reader.tag();
    if (!visit(no, wireType, reader)) {
      reader.skip(wireType, no);
    }
  }
}

/** The payloads of the retired repeated message field `no` held in `unknown`. */
export function retiredMessages(unknown: readonly UnknownField[], no: number): Uint8Array[] {
  return unknown
    .filter((field) => field.no === no && field.wireType === WireType.LengthDelimited)
    .map((field) => new BinaryReader(field.data).bytes());
}

/** `unknown` without field `no`; undefined when nothing is left. */
export function without(unknown: readonly UnknownField[], no: number): UnknownField[] | undefined {
  const kept = unknown.filter((field) => field.no !== no);
  return kept.length === 0 ? undefined : kept;
}

/** Drops field `no` from a decoded message's unknown fields, leaving none behind when it was the last. */
export function dropRetired(message: { $unknown?: UnknownField[] }, no: number): void {
  const kept = without(message.$unknown ?? [], no);
  if (kept === undefined) {
    delete message.$unknown;
  } else {
    message.$unknown = kept;
  }
}
