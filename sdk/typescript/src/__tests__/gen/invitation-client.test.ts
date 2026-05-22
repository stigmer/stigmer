import { describe, it, expect } from "vitest";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { InvitationSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { InvitationSpecSchema } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { stripUndefined, toTimestamp } from "../../gen/proto-utils";

/**
 * Exercises the same code path as the generated `buildInvitationProto` to
 * verify that Timestamp fields serialize without error after the codegen fix.
 */
function buildInvitationProto(input: {
  name: string;
  org: string;
  role: IamRole;
  expiresAt: Date | string;
  maxRedemptions?: number;
  label?: string;
}) {
  const expiresAt = input.expiresAt !== undefined ? toTimestamp(input.expiresAt) : undefined;
  return Object.assign(create(InvitationSchema), {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "Invitation",
    metadata: Object.assign(create(ApiResourceMetadataSchema), {
      name: input.name,
      org: input.org,
    }),
    spec: Object.assign(create(InvitationSpecSchema), stripUndefined({
      role: input.role,
      maxRedemptions: input.maxRedemptions,
      expiresAt,
      label: input.label,
    })),
  });
}

describe("buildInvitationProto", () => {
  it("produces a message with a valid Timestamp from a Date", () => {
    const expiresAt = new Date("2026-06-19T12:00:00.000Z");
    const msg = buildInvitationProto({
      name: "test-invite",
      org: "acme",
      role: IamRole.viewer,
      expiresAt,
    });

    expect(msg.spec?.expiresAt).toBeDefined();
    expect(msg.spec!.expiresAt!.seconds).toBe(
      BigInt(Math.floor(expiresAt.getTime() / 1000)),
    );
    expect(timestampDate(msg.spec!.expiresAt!).getTime()).toBe(
      expiresAt.getTime(),
    );
  });

  it("produces a message with a valid Timestamp from an ISO string", () => {
    const isoString = "2026-07-01T00:00:00.000Z";
    const msg = buildInvitationProto({
      name: "string-invite",
      org: "acme",
      role: IamRole.member,
      expiresAt: isoString,
    });

    const expected = new Date(isoString);
    expect(msg.spec?.expiresAt).toBeDefined();
    expect(msg.spec!.expiresAt!.seconds).toBe(
      BigInt(Math.floor(expected.getTime() / 1000)),
    );
  });

  it("serializes to binary without error (the original bug)", () => {
    const msg = buildInvitationProto({
      name: "binary-test",
      org: "acme",
      role: IamRole.admin,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      maxRedemptions: 1,
      label: "test label",
    });

    const bytes = toBinary(InvitationSchema, msg);
    expect(bytes.length).toBeGreaterThan(0);

    const decoded = fromBinary(InvitationSchema, bytes);
    expect(decoded.spec?.expiresAt).toBeDefined();
    expect(decoded.spec!.expiresAt!.seconds).toBe(msg.spec!.expiresAt!.seconds);
    expect(decoded.spec?.role).toBe(IamRole.admin);
    expect(decoded.spec?.maxRedemptions).toBe(1);
    expect(decoded.spec?.label).toBe("test label");
    expect(decoded.metadata?.name).toBe("binary-test");
    expect(decoded.metadata?.org).toBe("acme");
  });

  it("handles 7-day expiry (matches UI default options)", () => {
    const now = Date.now();
    const sevenDays = new Date(now + 7 * 86_400_000);
    const msg = buildInvitationProto({
      name: "7day",
      org: "test-org",
      role: IamRole.viewer,
      expiresAt: sevenDays,
    });

    const bytes = toBinary(InvitationSchema, msg);
    const decoded = fromBinary(InvitationSchema, bytes);
    const decodedDate = timestampDate(decoded.spec!.expiresAt!);

    const diffMs = Math.abs(decodedDate.getTime() - sevenDays.getTime());
    expect(diffMs).toBeLessThan(1000);
  });

  it("handles 30-day expiry (matches UI default options)", () => {
    const now = Date.now();
    const thirtyDays = new Date(now + 30 * 86_400_000);
    const msg = buildInvitationProto({
      name: "30day",
      org: "test-org",
      role: IamRole.owner,
      expiresAt: thirtyDays,
    });

    const bytes = toBinary(InvitationSchema, msg);
    const decoded = fromBinary(InvitationSchema, bytes);
    const decodedDate = timestampDate(decoded.spec!.expiresAt!);

    const diffMs = Math.abs(decodedDate.getTime() - thirtyDays.getTime());
    expect(diffMs).toBeLessThan(1000);
  });
});
