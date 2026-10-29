/**
 * Query-string escaping with one fixed character set, shared by every link
 * the server writes a query value into (the artifact storage's signed
 * download links).
 *
 * The set: the unreserved characters [A-Za-z0-9-_.~] pass, a space becomes
 * '+', and every other byte of the UTF-8 encoding is percent-encoded in
 * upper-case hex. URLSearchParams is not used because it escapes '~' and
 * leaves '*' bare; a link's bytes are what a client sees and what the
 * signed-URL tests pin, so the set is stated here once.
 */

/**
 * One query value or key, escaped: unreserved [A-Za-z0-9-_.~] pass, space
 * becomes '+', everything else percent-encodes.
 */
export function queryEscape(s: string): string {
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
 * A query string of single-valued params: keys sorted lexicographically,
 * keys and values escaped by `queryEscape`, joined with '&'.
 */
export function encodeQueryValues(values: Record<string, string>): string {
  return Object.keys(values)
    .sort()
    .map((key) => `${queryEscape(key)}=${queryEscape(values[key] ?? "")}`)
    .join("&");
}
