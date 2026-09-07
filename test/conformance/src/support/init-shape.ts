// The return type of every fixture builder in this folder.
// Domain: conformance support.
//
// protobuf-es's `MessageInitShape<Desc>` is a UNION: the fully-built
// message (`$typeName` and all) OR the plain init object `create()`
// accepts. A builder that returns the union hands its caller a trap:
// spreading the result and overriding a nested field with a plain object
// (`{ ...makeMemory(org), spec: { content, subjectIdentityAccountId } }`)
// makes TypeScript pick the message branch — whose `spec` must be a full
// `MemorySpec` — because the init branch declares `$typeName?: never`.
// Under the union, the suites that spread a builder compiled only when
// they overrode with a real message (`metadata: created.metadata`); the
// memory suite, which overrides `spec` with plain data, did not
// (stigmer#999).
//
// Builders return plain init objects, never built messages, so their
// return type says exactly that: the init half alone. Every consumer
// (`create(Schema, …)`, the generated client methods) accepts it, and a
// spread-and-override of any nested field with plain data typechecks.
//
// Parameters that ACCEPT fixtures stay `MessageInitShape` — an input is
// right to take either half.
import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";

export type InitShape<Desc extends DescMessage> = Exclude<
  MessageInitShape<Desc>,
  MessageShape<Desc>
>;
