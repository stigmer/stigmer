/**
 * Byte-exact ports of Go's net/url query encoding — shared by the artifact
 * storage's signed URLs (#17) and the github broker's authorize-URL/token
 * exchange (#13). Promoted out of src/artifactstorage/ on its second
 * consumer per the shared-steps guideline.
 *
 * WHY not URLSearchParams: it differs from Go's url.QueryEscape on two
 * characters ('~' escaped, '*' bare), which would break URL byte parity
 * for values carrying them. The Go server is the behavioral reference for
 * every URL a client sees during coexistence.
 */

/**
 * Go url.QueryEscape, byte-exact: unreserved [A-Za-z0-9-_.~] pass, space
 * becomes '+', everything else percent-encodes.
 */
export function goQueryEscape(s: string): string {
  let out = "";
  for (const byte of Buffer.from(s, "utf-8")) {
    const c = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(c)) {
      out += c;
    } else if (c === " ") {
      out += "+";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

/**
 * Go url.Values.Encode for single-valued params: keys sorted
 * lexicographically, keys and values QueryEscape'd, joined with '&'.
 */
export function goUrlValuesEncode(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${goQueryEscape(key)}=${goQueryEscape(values[key] ?? "")}`)
    .join("&");
}
