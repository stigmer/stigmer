// Canonical valid ApiKey fixture for the conformance suite, and the one
// read of a freshly minted key's plaintext.
// Domain: conformance support.
//
// An ApiKey (`stk_…`) is the credential a machine presents to a server with
// sign-in on: the runner, CI, the CLI. It is minted by a signed-in person,
// scoped to an organization, and the server keeps only a hash — the create
// response is the ONE place the plaintext ever appears (the apikey suite
// pins that `get` answers the hash, never the plaintext). Suites that need a
// machine credential (the apikey suite itself; the execution lane that keys
// a runner with the operator's key) mint through this module so the shape
// of a key request and the reading of its plaintext live in one place.
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { InitShape } from "./init-shape";

export const API_KEY_API_VERSION = "iam.stigmer.ai/v1";
export const API_KEY_KIND = "ApiKey";

// The prefix every minted key carries; the plaintext read below refuses
// anything else, because a create response without it is a hash or nothing.
export const API_KEY_PLAINTEXT_PREFIX = "stk_";

export interface ApiKeyOptions {
  org: string;
  name: string;
}

export function makeApiKey(
  opts: ApiKeyOptions,
): InitShape<typeof ApiKeySchema> {
  return {
    apiVersion: API_KEY_API_VERSION,
    kind: API_KEY_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {},
  };
}

// The plaintext of a key as the create response carries it (`spec.key_hash`
// holds the plaintext exactly once, on create). Throws when the response
// carries none, so a caller never boots a process with an empty credential
// and reads the resulting refusal as the behaviour under test.
export function plaintextKeyOf(created: ApiKey): string {
  const plaintext = created.spec?.keyHash ?? "";
  if (!plaintext.startsWith(API_KEY_PLAINTEXT_PREFIX)) {
    throw new Error(
      `ApiKey create answered no plaintext key (expected a "${API_KEY_PLAINTEXT_PREFIX}" value in spec.key_hash on the create response)`,
    );
  }
  return plaintext;
}
