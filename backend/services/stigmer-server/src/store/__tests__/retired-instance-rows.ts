/**
 * Test support: the bytes an earlier release wrote for the rows the agent
 * instance kind's removal migrates, built by wire number because the
 * schemas that wrote them no longer exist — an AgentInstance row
 * (api_version 1, kind 2, metadata 3, spec 4 { agent_id 1, description 2 },
 * status 5) and a Session row whose spec carries the retired
 * agent_instance_id (SessionSpec field 1), with or without the status (its
 * audit) the session had gained by then. Shared by the module's unit test,
 * the frozen-envelope test and both drivers' migration tests, so every one
 * reads the same old shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SessionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/status_pb";
import {
  ApiResourceMetadataSchema,
  type ApiResourceMetadata,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { ApiResourceAuditStatusSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

/** An AgentInstance row as an earlier release stored it. */
export function retiredInstanceRow(options: {
  readonly metadata: MessageInitShape<typeof ApiResourceMetadataSchema>;
  readonly agentId: string;
  readonly description?: string;
}): Uint8Array {
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(options.agentId);
  if ((options.description ?? "") !== "") {
    spec.tag(2, WireType.LengthDelimited).string(options.description ?? "");
  }
  const status = toBinary(
    ApiResourceAuditStatusSchema,
    create(ApiResourceAuditStatusSchema, {
      audit: { specAudit: { event: "created" } },
    }),
  );
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("AgentInstance")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish())
    .tag(5, WireType.LengthDelimited)
    .bytes(status)
    .finish();
}

/**
 * A Session row as an earlier release stored it: the given spec with the
 * retired instance id written ahead of it as SessionSpec field 1 (omitted
 * when empty, as proto3 omits an empty string), and the status it carried,
 * when given (Session field 5; an earlier release's status held its audit,
 * never an agent).
 */
export function retiredSessionRow(options: {
  readonly metadata: MessageInitShape<typeof ApiResourceMetadataSchema>;
  readonly instanceId: string;
  readonly spec?: MessageInitShape<typeof SessionSpecSchema>;
  readonly status?: MessageInitShape<typeof SessionStatusSchema>;
}): Uint8Array {
  const spec = new BinaryWriter();
  if (options.instanceId !== "") {
    spec.tag(1, WireType.LengthDelimited).string(options.instanceId);
  }
  spec.raw(specBytes(create(SessionSpecSchema, options.spec ?? {})));
  const row = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("agentic.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("Session")
    .tag(3, WireType.LengthDelimited)
    .bytes(metadataBytes(options.metadata))
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish());
  if (options.status !== undefined) {
    row
      .tag(5, WireType.LengthDelimited)
      .bytes(
        toBinary(
          SessionStatusSchema,
          create(SessionStatusSchema, options.status),
        ),
      );
  }
  return row.finish();
}

/** The current encoding of a session (the envelope retiredSessionRow writes), for byte comparisons. */
export function sessionBytes(
  init: MessageInitShape<typeof SessionSchema>,
): Uint8Array {
  return toBinary(
    SessionSchema,
    create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      ...init,
    }),
  );
}

function metadataBytes(
  init: MessageInitShape<typeof ApiResourceMetadataSchema>,
): Uint8Array {
  const metadata: ApiResourceMetadata = create(ApiResourceMetadataSchema, init);
  return toBinary(ApiResourceMetadataSchema, metadata);
}

function specBytes(spec: SessionSpec): Uint8Array {
  return toBinary(SessionSpecSchema, spec);
}
