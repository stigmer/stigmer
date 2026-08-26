// gojson reproduces Go's encoding/json output byte-for-byte.
//
// Every committed codegen artifact (schemas, task registry, meta.json) was
// written by Go's json.MarshalIndent, whose output differs from
// JSON.stringify in ways that would break the byte-parity gates:
//
//   - HTML escaping: '<', '>', '&' become \u003c, \u003e, \u0026 (committed
//     files contain these in comment text like "<org-id>").
//   - U+2028/U+2029 are escaped; JSON.stringify emits them raw.
//   - Map-typed values serialize with lexicographically sorted keys (Go
//     sorts map keys); struct-typed values keep declaration order.
//   - json.MarshalIndent emits no trailing newline.
//
// Value model mapping Go's type system onto JS:
//   - plain object = Go struct: insertion order, `undefined` = omitempty
//     (field dropped entirely).
//   - Map<string, ...>  = Go map: keys sorted by UTF-8 byte order.
//   - null = Go nil pointer/slice/map (marshals as `null`).
//   - []   = Go empty-but-non-nil slice (marshals as `[]`).
// Callers express each Go struct's field order and omitempty decisions when
// constructing the value; this module owns only the byte layout.

export type GoJsonValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | GoJsonValue[]
  | GoJsonStruct
  | Map<string, GoJsonValue>;

export interface GoJsonStruct {
  [key: string]: GoJsonValue | undefined;
}

/** Equivalent of json.MarshalIndent(v, "", indent) — no trailing newline. */
export function marshalIndent(value: GoJsonValue, indent = "  "): string {
  return marshal(value, indent, 0);
}

function marshal(value: GoJsonValue, indent: string, depth: number): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return formatNumber(value);
    case "bigint":
      return value.toString();
    case "string":
      return encodeString(value);
    default:
      break;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const inner = indent.repeat(depth + 1);
    const items = value.map((item) => inner + marshal(item, indent, depth + 1));
    return "[\n" + items.join(",\n") + "\n" + indent.repeat(depth) + "]";
  }

  let entries: Array<[string, GoJsonValue]>;
  if (value instanceof Map) {
    entries = [...value.entries()].sort((a, b) => compareUtf8(a[0], b[0]));
  } else {
    entries = Object.entries(value).filter(
      (entry): entry is [string, GoJsonValue] => entry[1] !== undefined,
    );
  }
  if (entries.length === 0) return "{}";
  const inner = indent.repeat(depth + 1);
  const fields = entries.map(
    ([key, v]) => inner + encodeString(key) + ": " + marshal(v, indent, depth + 1),
  );
  return "{\n" + fields.join(",\n") + "\n" + indent.repeat(depth) + "}";
}

// Go's floatEncoder: 'f' formatting for 1e-6 <= |v| < 1e21, exponent form
// outside, with the leading zero stripped from two-digit negative exponents
// ("1e-07" → "1e-7"). JS Number.prototype.toString uses the same shortest
// round-trip digits AND the same range thresholds and exponent shapes, so
// String(v) matches — pinned by tests rather than re-derived here. The two
// remaining gaps are handled explicitly: Go marshals -0 as "-0" (JS says
// "0"), and Go rejects NaN/±Inf with an error.
function formatNumber(v: number): string {
  if (!Number.isFinite(v)) {
    throw new Error(`gojson: unsupported value: ${v} (Go's encoding/json rejects NaN and Inf)`);
  }
  if (Object.is(v, -0)) return "-0";
  return String(v);
}

// Go's appendString with escapeHTML=true: pass bytes >= 0x20 through except
// '"', '\\', '<', '>', '&'; short escapes for \n \r \t; \u00XX for other
// control chars; \u2028/\u2029 escaped; invalid UTF-8 (JS: lone surrogates)
// becomes the literal escape \ufffd.
function encodeString(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += "\\\\";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0d) out += "\\r";
    else if (code === 0x09) out += "\\t";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code === 0x3c) out += "\\u003c";
    else if (code === 0x3e) out += "\\u003e";
    else if (code === 0x26) out += "\\u0026";
    else if (code === 0x2028) out += "\\u2028";
    else if (code === 0x2029) out += "\\u2029";
    else if (code >= 0xd800 && code <= 0xdfff) out += "\\ufffd";
    else out += ch;
  }
  return out + '"';
}

// Go sorts map keys with sort.Strings — byte order over UTF-8. JS default
// string comparison is UTF-16 code unit order, which diverges for code
// points above the basic multilingual plane, so compare encoded bytes.
function compareUtf8(a: string, b: string): number {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return Buffer.compare(ab, bb);
}
