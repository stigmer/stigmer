// String helpers ported byte-for-byte from the Go extractor. Each mirrors a
// specific Go function whose exact behavior is baked into the committed
// schema bytes — do not "improve" them.

/**
 * Go's toCamelCase: split on "_", uppercase the first letter of each part
 * and LOWERCASE the rest (so "icon_URL" becomes "IconUrl", not "IconURL").
 */
export function toCamelCase(s: string, capitalizeFirst: boolean): string {
  const parts = s.split("_");
  for (let i = 0; i < parts.length; i++) {
    if (i === 0 && !capitalizeFirst) continue;
    const part = parts[i];
    if (part.length > 0) {
      parts[i] = part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase();
    }
  }
  return parts.join("");
}

/**
 * Task kind from a message name: strip the "TaskConfig" suffix, insert "_"
 * before every interior capital, uppercase. "HttpCallTaskConfig" → "HTTP_CALL";
 * a Spec message like "AgentSpec" (no suffix to strip) → "AGENT_SPEC".
 */
export function extractTaskKind(messageName: string): string {
  const name = trimSuffix(messageName, "TaskConfig");
  let result = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (i > 0 && ch >= "A" && ch <= "Z") {
      result += "_";
    }
    result += ch;
  }
  return result.toUpperCase();
}

/** Go's strings.TrimSuffix: removes the suffix once, if present. */
export function trimSuffix(s: string, suffix: string): string {
  return suffix.length > 0 && s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : s;
}

/** Uppercases the first character (Go capitalize helper). */
export function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.slice(0, 1).toUpperCase() + s.slice(1);
}

/**
 * Comparator reproducing Go filepath.Walk's visit order for file paths:
 * directory entries are visited in lexical order per directory, so paths
 * compare component-by-component ("foo" the directory sorts before
 * "foo.proto" the file, unlike a plain full-string comparison).
 */
export function compareWalkOrder(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    if (as[i] < bs[i]) return -1;
    if (as[i] > bs[i]) return 1;
  }
  return as.length - bs.length;
}
