/**
 * Test support: the bytes an earlier release wrote for a PlatformClient
 * row, built by wire number because the schema that wrote them no longer
 * exists: api_version 1, kind 2, metadata 3, spec 4 { client_id 1,
 * client_secret_hash 2, allowed_origins 9, create_accounts_on_sign_in 11,
 * sign_in_role 12, vaults 13 }, status 5 { vault_attachers 2, audit 99 }.
 * Shared by the module's unit test, the frozen-envelope test and both
 * drivers' migration tests, so every one reads the same old shape.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";

import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import { ApiResourceAuditSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";

/** A PlatformClient row as an earlier release stored it. */
export function retiredPlatformClientRow(options: {
  readonly metadata: MessageInitShape<typeof ApiResourceMetadataSchema>;
  readonly clientId: string;
  readonly allowedOrigins?: ReadonlyArray<string>;
  readonly signInRole?: number;
  readonly vaults?: ReadonlyArray<MessageInitShape<typeof ApiResourceReferenceSchema>>;
  readonly vaultAttachers?: Readonly<Record<string, string>>;
}): Uint8Array {
  const spec = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(options.clientId)
    .tag(2, WireType.LengthDelimited)
    .string("sha256:hash-of-the-secret");
  for (const origin of options.allowedOrigins ?? []) {
    spec.tag(9, WireType.LengthDelimited).string(origin);
  }
  spec.tag(11, WireType.Varint).bool(true);
  if ((options.signInRole ?? 0) !== 0) {
    spec.tag(12, WireType.Varint).int32(options.signInRole ?? 0);
  }
  for (const vault of options.vaults ?? []) {
    spec
      .tag(13, WireType.LengthDelimited)
      .bytes(toBinary(ApiResourceReferenceSchema, create(ApiResourceReferenceSchema, vault)));
  }
  const status = new BinaryWriter();
  for (const [vaultId, account] of Object.entries(options.vaultAttachers ?? {})) {
    status
      .tag(2, WireType.LengthDelimited)
      .bytes(
        new BinaryWriter()
          .tag(1, WireType.LengthDelimited)
          .string(vaultId)
          .tag(2, WireType.LengthDelimited)
          .string(account)
          .finish(),
      );
  }
  status
    .tag(99, WireType.LengthDelimited)
    .bytes(
      toBinary(
        ApiResourceAuditSchema,
        create(ApiResourceAuditSchema, { specAudit: { event: "created" } }),
      ),
    );
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string("iam.stigmer.ai/v1")
    .tag(2, WireType.LengthDelimited)
    .string("PlatformClient")
    .tag(3, WireType.LengthDelimited)
    .bytes(
      toBinary(ApiResourceMetadataSchema, create(ApiResourceMetadataSchema, options.metadata)),
    )
    .tag(4, WireType.LengthDelimited)
    .bytes(spec.finish())
    .tag(5, WireType.LengthDelimited)
    .bytes(status.finish())
    .finish();
}
