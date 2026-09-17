// Pins the one plaintext read in support/apikeys.ts: a create response
// carrying an `stk_` key answers it, and anything else — a hash (what `get`
// answers), an empty spec — throws instead of handing a caller an empty
// credential to boot a process with.
import { create } from "@bufbuild/protobuf";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { describe, expect, it } from "vitest";

import {
  API_KEY_PLAINTEXT_PREFIX,
  makeApiKey,
  plaintextKeyOf,
} from "../apikeys";

describe("plaintextKeyOf", () => {
  it("answers the stk_ plaintext a create response carries", () => {
    const created = create(ApiKeySchema, {
      spec: { keyHash: `${API_KEY_PLAINTEXT_PREFIX}abc123` },
    });
    expect(plaintextKeyOf(created)).toBe(`${API_KEY_PLAINTEXT_PREFIX}abc123`);
  });

  it("refuses a hash and an empty spec rather than answering an empty credential", () => {
    expect(() =>
      plaintextKeyOf(
        create(ApiKeySchema, { spec: { keyHash: "sha256:deadbeef" } }),
      ),
    ).toThrow(/no plaintext key/);
    expect(() => plaintextKeyOf(create(ApiKeySchema, {}))).toThrow(
      /no plaintext key/,
    );
  });
});

describe("makeApiKey", () => {
  it("is the ApiKey resource shape with the organization on its metadata", () => {
    expect(makeApiKey({ org: "acme", name: "runner-key" })).toEqual({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "runner-key", org: "acme" },
      spec: {},
    });
  });
});
