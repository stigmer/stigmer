/**
 * Pins harness-word-renamed.ts: what one stored identity account becomes
 * when its default harness holds a word the platform no longer takes.
 *
 *   - `native` becomes `stigmer` and `cursor` is cleared, every other field
 *     kept, and the account then validates as an update validates it (the
 *     whole stored message), which it did not before;
 *   - a row that carried an etag is stamped again, as a write would;
 *   - a default of `stigmer`, `claude` or none, and an account with no
 *     preferences, is left alone (undefined);
 *   - a field no release defined rides through;
 *   - bytes that do not decode throw, and the step's error names the row.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";

import { etagOf, stampEtag } from "../etag.js";
import { migrateHarnessWordRow, unreadableHarnessWordError } from "../harness-word-renamed.js";

const metadata = { id: "ida_1", org: "org_1", slug: "ada", name: "Ada" };

function account(defaultHarness: string, stamped = false): Uint8Array {
  const init: MessageInitShape<typeof IdentityAccountSchema> = {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata,
    spec: {
      idpId: "auth0|ada",
      email: "ada@acme.example",
      preferences: { defaultHarness, defaultStigmerModel: "claude-sonnet-4.6", memoryEnabled: true },
    },
  };
  const resource = create(IdentityAccountSchema, init);
  if (stamped) {
    stampEtag(IdentityAccountSchema, resource);
  }
  return toBinary(IdentityAccountSchema, resource);
}

const validator = createValidator();

describe("migrateHarnessWordRow", () => {
  it.each([
    ["native", "stigmer"],
    ["cursor", ""],
  ])("rewrites a stored %s to %j, keeps the rest, and the account validates again", (stored, becomes) => {
    const before = fromBinary(IdentityAccountSchema, account(stored));
    expect(validator.validate(IdentityAccountSchema, before).kind, "the stored word fails the update's validation").toBe("invalid");

    const migrated = fromBinary(IdentityAccountSchema, migrateHarnessWordRow(account(stored))!);
    expect(migrated).toEqual(fromBinary(IdentityAccountSchema, account(becomes)));
    expect(validator.validate(IdentityAccountSchema, migrated).kind).toBe("valid");
  });

  it("stamps a row that carried an etag again, as a write would", () => {
    const migrated = fromBinary(IdentityAccountSchema, migrateHarnessWordRow(account("native", true))!);
    const etag = migrated.metadata?.etag ?? "";
    expect(etag).not.toBe("");
    expect(etag).toBe(etagOf(IdentityAccountSchema, migrated));
    expect(etag).not.toBe(fromBinary(IdentityAccountSchema, account("native", true)).metadata?.etag);
  });

  it.each(["stigmer", "claude", ""])("leaves a default of %j alone", (stored) => {
    expect(migrateHarnessWordRow(account(stored))).toBeUndefined();
  });

  it("leaves an account with no preferences alone", () => {
    const bare = toBinary(IdentityAccountSchema, create(IdentityAccountSchema, { metadata, spec: { idpId: "auth0|ada" } }));
    expect(migrateHarnessWordRow(bare)).toBeUndefined();
  });

  it("keeps a field no release defined", () => {
    const row = fromBinary(IdentityAccountSchema, account("native"));
    row.spec!.preferences!.$unknown = [{ no: 900, wireType: 2, data: new Uint8Array([2, 0x68, 0x69]) }];
    const migrated = fromBinary(IdentityAccountSchema, migrateHarnessWordRow(toBinary(IdentityAccountSchema, row))!);
    expect((migrated.spec?.preferences?.$unknown ?? []).map((field) => field.no)).toEqual([900]);
    expect(migrated.spec?.preferences?.defaultHarness).toBe("stigmer");
  });

  it("throws on bytes that do not decode, and the step's error names the row", () => {
    expect(() => migrateHarnessWordRow(new Uint8Array([0xff, 0xff, 0xff]))).toThrow();
    const error = unreadableHarnessWordError("ida_bad", new Error("premature EOF"));
    expect(error.message).toBe(
      "identity_account 'ida_bad' cannot be read to rewrite its default harness: Error: premature EOF",
    );
    expect(error.cause).toBeInstanceOf(Error);
  });
});
