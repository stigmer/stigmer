/**
 * Pins the internal credential read a run's resolution takes
 * (credential/values.ts), on the arms a real store and a working key never
 * reach.
 *
 * credentialsOfOrg: a run with no organization reads no credentials and
 * never queries; a row that does not decode is skipped rather than failing
 * every run of the organization; a row the index answered for another
 * organization is never handed over.
 *
 * CredentialValues.fieldValue, per the module's error doctrine: a value
 * that cannot be decrypted (tampered, another key's) is that one value's
 * problem, logged and read as absent, so the run is refused for a missing
 * value rather than given junk; a sealed value with no key configured is
 * an infrastructure fault, Internal, naming the credential and the field,
 * because the stored value may be fine.
 */
import { randomBytes } from "node:crypto";

import { create, toBinary } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import type { LogFields } from "../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
} from "../../../encryption/encryption.js";
import { errorOf, untouchable } from "../../../pipeline/__tests__/support.js";
import type { Store } from "../../../store/interface.js";
import type { ListIndexRow } from "../../../store/list-index.js";
import { CredentialValues, credentialsOfOrg } from "../values.js";

const ORG = "acme";
const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function row(id: string, data: Uint8Array): ListIndexRow {
  return { id, data, cursor: { createdAt: "", id } };
}

function credentialIn(org: string, id: string) {
  return create(CredentialSchema, { metadata: { id, org, slug: id } });
}

describe("credentialsOfOrg", () => {
  it("a run with no organization reads nothing and never queries", async () => {
    expect(await credentialsOfOrg(untouchable<Store>("store"), "")).toEqual([]);
  });

  it("skips a row that does not decode and a row of another organization", async () => {
    const store = {
      queryResources: () =>
        Promise.resolve([
          // Field 1 with wire type 7, which no message encodes.
          row("cred_garbled", new Uint8Array([0x0f])),
          row(
            "cred_ours",
            toBinary(CredentialSchema, credentialIn(ORG, "cred_ours")),
          ),
          row(
            "cred_theirs",
            toBinary(CredentialSchema, credentialIn("other", "cred_theirs")),
          ),
        ]),
    } as unknown as Store;

    const credentials = await credentialsOfOrg(store, ORG);

    expect(credentials.map((credential) => credential.metadata?.id)).toEqual([
      "cred_ours",
    ]);
  });
});

describe("CredentialValues.fieldValue — a value that cannot be read", () => {
  it("a value sealed under another key is logged and read as absent", async () => {
    const sealedElsewhere = await SecretService.create(randomBytes(32)).encrypt(
      "sk-live",
      EncryptionScope.forOrganization(ORG),
    );
    const credential = create(CredentialSchema, {
      metadata: { id: "cred_rekeyed", org: ORG },
      spec: { fields: { API_KEY: { value: sealedElsewhere } } },
    });
    const warnings: Array<{ message: string; fields: LogFields | undefined }> =
      [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: () => {},
      sink: ({ message, fields }) => warnings.push({ message, fields }),
    });

    const value = await new CredentialValues(
      SecretService.create(randomBytes(32)),
      logger,
    ).fieldValue(credential, "API_KEY");

    expect(value).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toBe(
      "Undecryptable ciphertext in a credential field — treated as absent",
    );
    expect(warnings[0]?.fields?.field).toBe("API_KEY");
    expect(warnings[0]?.fields?.credentialId).toBe("cred_rekeyed");
    // The value itself never reaches the log.
    expect(JSON.stringify(warnings)).not.toContain("sk-live");
  });

  it("a sealed value with no key configured is Internal, naming the credential and the field", async () => {
    const sealed = await SecretService.create(randomBytes(32)).encrypt(
      "sk-live",
      EncryptionScope.forOrganization(ORG),
    );
    const credential = create(CredentialSchema, {
      metadata: { id: "cred_keyless", org: ORG },
      spec: { fields: { API_KEY: { value: sealed } } },
    });

    const error = await errorOf(() =>
      new CredentialValues(
        SecretService.create(undefined),
        silentLogger,
      ).fieldValue(credential, "API_KEY"),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "credential cred_keyless holds an encrypted field 'API_KEY' but no encryption key is configured",
    );
  });
});
