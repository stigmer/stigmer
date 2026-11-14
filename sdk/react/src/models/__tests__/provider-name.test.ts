// Holds a provider's display name: the kit's own for the providers it knows,
// any other id capitalized, as the presentation table names it too.

import { describe, it, expect } from "vitest";
import { providerName } from "../provider-name";
import { presentationOf } from "../provider-presentation";

describe("providerName", () => {
  it("names the providers the kit knows as they write themselves, and any other by its id", () => {
    expect(["anthropic", "openai", "mistral"].map(providerName)).toEqual(["Anthropic", "OpenAI", "Mistral"]);
  });

  it("agrees with the presentation table", () => {
    for (const id of ["anthropic", "openai", "mistral"]) expect(presentationOf(id).name).toBe(providerName(id));
  });
});
