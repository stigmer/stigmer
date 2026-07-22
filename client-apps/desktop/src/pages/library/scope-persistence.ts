export type LibraryScope = "org" | "all";

const SCOPE_KEYS = {
  agents: "stigmer:library:agents:scope",
  skills: "stigmer:library:skills:scope",
  "mcp-servers": "stigmer:library:mcp-servers:scope",
  datastores: "stigmer:library:datastores:scope",
} as const;

export type LibraryResourceKey = keyof typeof SCOPE_KEYS;

export function readPersistedScope(key: LibraryResourceKey): LibraryScope {
  const stored = localStorage.getItem(SCOPE_KEYS[key]);
  return stored === "all" ? "all" : "org";
}

export function writePersistedScope(
  key: LibraryResourceKey,
  scope: LibraryScope,
): void {
  localStorage.setItem(SCOPE_KEYS[key], scope);
}
