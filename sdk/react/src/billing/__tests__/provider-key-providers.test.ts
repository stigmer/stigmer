// The kit's list of providers a key is saved for (PROVIDER_KEY_PROVIDERS in
// billing/useProviderKeys.ts) is the key contract's own list
// (billing/providerkey/v1, io.proto), read from the contract's generated
// descriptor, in its order, on set and on delete alike: a provider added to
// the contract and not here fails this test rather than an admin's card,
// and every provider here is presented with a name, a key page and a mark.
import { type DescMessage, getOption } from "@bufbuild/protobuf";
import {
  DeleteProviderKeyInputSchema,
  SetProviderKeyInputSchema,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/io_pb";
import { field } from "@stigmer/apis/buf/validate/validate_pb";
import { describe, expect, it } from "vitest";
import { isKeyProvider } from "../../models/hub/ProviderCard";
import { presentationOf } from "../../models/provider-presentation";
import { PROVIDER_KEY_PROVIDERS } from "../useProviderKeys";

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
    expect(contractProviders(SetProviderKeyInputSchema)).toEqual([...PROVIDER_KEY_PROVIDERS]);
    expect(contractProviders(DeleteProviderKeyInputSchema)).toEqual([...PROVIDER_KEY_PROVIDERS]);
  });

  it("each takes a key on its card, and a name the contract does not hold does not", () => {
    expect(PROVIDER_KEY_PROVIDERS.every(isKeyProvider)).toBe(true);
    expect(isKeyProvider("gemini")).toBe(false);
    expect(isKeyProvider("mistral")).toBe(false);
  });

  it("each presented by its own name, with where to get a key and how a laptop's runner gets one", () => {
    expect(PROVIDER_KEY_PROVIDERS.map((p) => presentationOf(p).name)).toEqual(["Anthropic", "OpenAI", "Google"]);
    for (const provider of PROVIDER_KEY_PROVIDERS) {
      const presentation = presentationOf(provider);
      expect(presentation.keysUrl).toMatch(/^https:\/\//);
      expect(presentation.runnerSetup?.commands.at(-1)).toBe("stigmer down && stigmer up");
    }
    expect(presentationOf("google").runnerSetup?.commands[0]).toBe("export GEMINI_API_KEY=<your key>");
  });
});
