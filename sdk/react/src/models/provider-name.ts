// A model provider's display name ("Anthropic", "OpenAI") from its id, in a
// module of its own: a surface that only names a provider (the provider-key
// notice before a first message) doesn't load the presentation table's key
// pages, billing links and runner setup with it.

/** The providers whose display name is not their id capitalized. */
const NAMES: Readonly<Record<string, string>> = { anthropic: "Anthropic", openai: "OpenAI" };

/** A provider's display name: the kit's own for the providers it knows, otherwise its id capitalized. */
export function providerName(provider: string): string {
  return NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}
