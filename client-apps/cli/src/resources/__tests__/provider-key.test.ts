// The CLI's list of providers a key is saved for (resources/provider-key.ts)
// is the key contract's own list (billing/providerkey/v1, io.proto), read
// from the contract's generated descriptor, in its order, on set and on
// delete alike: a provider added to the contract and not here, or here and
// not there, fails this test rather than a person's command.
import { type DescMessage, getOption } from "@bufbuild/protobuf";
import {
  DeleteProviderKeyInputSchema,
  SetProviderKeyInputSchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/io_pb";
import { field } from "@stigmer/apis/buf/validate/validate_pb";
import { describe, expect, it } from "vitest";

import { PROVIDERS, providerDisplayName } from "../provider-key.js";

/** The providers a key contract input's `provider` field accepts, in its order. */
function contractProviders(schema: DescMessage): readonly string[] {
  const provider = schema.fields.find((f) => f.name === "provider");
  if (provider === undefined) throw new Error(`${schema.typeName} has no provider field`);
  const rules = getOption(provider, field);
  if (rules.type.case !== "string") throw new Error(`${schema.typeName}.provider has no string rules`);
  return rules.type.value.in;
}

describe("the providers a key is saved for", () => {
  it("are the key contract's, in its order, on set and on delete", () => {
    expect(contractProviders(SetProviderKeyInputSchema)).toEqual([...PROVIDERS]);
    expect(contractProviders(DeleteProviderKeyInputSchema)).toEqual([...PROVIDERS]);
  });

  it("each read by its own name, and a name the CLI does not know as it came", () => {
    expect(PROVIDERS.map(providerDisplayName)).toEqual(["Anthropic", "OpenAI", "Google"]);
    expect(providerDisplayName("mistral")).toBe("mistral");
  });
});
