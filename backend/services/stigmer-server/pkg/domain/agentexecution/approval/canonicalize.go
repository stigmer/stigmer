package approval

// Deterministic canonicalization of a tool action into a byte-stable form — the
// Go edition of the cross-language HITL approval contract.
//
// This is a faithful port of the TypeScript source of truth
// (backend/services/runner/src/shared/approval-canonicalize.ts). The runner is
// the sole enforcement point; Go does not gate side effects. This edition exists
// to satisfy the dual-edition (D1) obligation: it must reproduce the shared
// vector corpus (apis/testdata/hitl/canonicalization/ + fingerprint/) byte for
// byte, exactly as the Phase-1 pending-approval projection is mirrored here. A
// drift between editions fails the parity test in either repo.
//
// Why a hand-rolled serializer instead of encoding/json: the canonical form is a
// cross-language contract, and Go's encoding/json differs from JS JSON.stringify
// in two ways that would silently break parity — it escapes <, >, & by default,
// and it encodes U+0008/U+000C as \u0008/\u000c rather than \b/\f. The serializer
// below matches JS JSON.stringify exactly over the constrained canonical domain
// (string, bool, null, integer, array, object), so the two editions agree.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"unicode/utf16"
)

// ToolActionInput mirrors the TS ToolActionInput. Fields are optional; absent
// values canonicalize to their empty form. `Args` is decoded with
// json.Decoder.UseNumber so integer literals survive as json.Number (see
// DecodeToolActionInput / the test decoder) and are reproduced exactly.
type ToolActionInput struct {
	// Engine tool name (Cursor PascalCase or native snake_case). Identity is kept
	// as-given (only trimmed); ToolKind normalizes cross-harness naming elsewhere.
	ToolName string `json:"toolName"`
	// MCP server slug, or empty for built-in tools.
	MCPServerSlug string `json:"mcpServerSlug"`
	// File paths the action targets (absolute or workspace-relative).
	Paths []string `json:"paths"`
	// Shell command line, when this is a shell action.
	ShellCommand string `json:"shellCommand"`
	// Remaining structured arguments. Values are any JSON scalar/array/object;
	// integers must arrive as json.Number to be reproduced without float drift.
	Args map[string]any `json:"args"`
	// Top-level keys within Args whose values are secrets: replaced by a stable
	// digest so the canonical form never carries cleartext.
	SecretKeys []string `json:"secretKeys"`
	// Workspace root used to rewrite absolute paths to workspace-relative ones.
	WorkspaceRoot string `json:"workspaceRoot"`
}

// CanonicalToolAction is the normalized action. Field order is irrelevant —
// canonicalJSON sorts keys — but the shape is the contract TS/Java reproduce.
type CanonicalToolAction struct {
	ToolName      string
	MCPServerSlug string
	Paths         []string
	ShellCommand  string
	Args          map[string]any
}

// CanonicalizeToolAction normalizes an input action: trim the tool name,
// lowercase the slug, normalize/sort paths, collapse shell whitespace, and
// redact declared secret args. Mirrors canonicalizeToolAction in TS.
func CanonicalizeToolAction(input ToolActionInput) CanonicalToolAction {
	return CanonicalToolAction{
		ToolName:      strings.TrimSpace(input.ToolName),
		MCPServerSlug: strings.ToLower(strings.TrimSpace(input.MCPServerSlug)),
		Paths:         normalizePaths(input.Paths, input.WorkspaceRoot),
		ShellCommand:  normalizeShellCommand(input.ShellCommand),
		Args:          redactSecrets(input.Args, input.SecretKeys),
	}
}

// CanonicalToolActionJSON is the single entry point: normalize, then serialize
// to canonical JSON. The returned string is the byte-stable contract value.
func CanonicalToolActionJSON(input ToolActionInput) (string, error) {
	return canonicalJSON(canonicalToActionMap(CanonicalizeToolAction(input)))
}

// canonicalToActionMap projects the canonical action into the generic shape the
// serializer walks. Keeping this explicit (rather than reflecting over the
// struct) keeps the serialized field names — and thus the contract — obvious.
func canonicalToActionMap(a CanonicalToolAction) map[string]any {
	paths := make([]any, len(a.Paths))
	for i, p := range a.Paths {
		paths[i] = p
	}
	args := a.Args
	if args == nil {
		args = map[string]any{}
	}
	return map[string]any{
		"toolName":      a.ToolName,
		"mcpServerSlug": a.MCPServerSlug,
		"paths":         paths,
		"shellCommand":  a.ShellCommand,
		"args":          args,
	}
}

// canonicalJSON serializes a value to RFC 8785-subset canonical JSON: object
// keys sorted by UTF-16 code unit, no insignificant whitespace, raw UTF-8.
//
// The input domain is deliberately constrained to string, bool, null, integer,
// array, and object — the shape of a normalized tool action. Non-integer numbers
// are rejected rather than implementing RFC 8785's full number formatting,
// keeping this serializer small and provably cross-language. Mirrors canonicalJson
// in TS.
func canonicalJSON(value any) (string, error) {
	var b strings.Builder
	if err := serialize(&b, value); err != nil {
		return "", err
	}
	return b.String(), nil
}

func serialize(b *strings.Builder, v any) error {
	switch t := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		if t {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case string:
		b.WriteString(encodeJSONString(t))
	case json.Number:
		s, err := canonicalNumber(t)
		if err != nil {
			return err
		}
		b.WriteString(s)
	case []any:
		b.WriteByte('[')
		for i, e := range t {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := serialize(b, e); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		return serializeObject(b, t)
	default:
		return fmt.Errorf("canonicalJSON: unsupported type %T", v)
	}
	return nil
}

func serializeObject(b *strings.Builder, obj map[string]any) error {
	// JSON null is kept (it has a representation); only absent keys are omitted,
	// which in Go means a missing map entry — there is no `undefined` to drop.
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i], keys[j]) })

	b.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(encodeJSONString(k))
		b.WriteByte(':')
		if err := serialize(b, obj[k]); err != nil {
			return err
		}
	}
	b.WriteByte('}')
	return nil
}

// canonicalNumber reproduces JS String(n) for the integer-only canonical domain.
// A literal with a decimal point or exponent is not part of the contract and is
// rejected — matching the TS serializer, which throws for non-integer numbers.
func canonicalNumber(n json.Number) (string, error) {
	s := string(n)
	if strings.ContainsAny(s, ".eE") {
		return "", fmt.Errorf("canonicalJSON: non-integer numbers are not part of the canonical contract: %q", s)
	}
	return s, nil
}

// encodeJSONString reproduces JS JSON.stringify(string): quote, escape " \ and
// the control characters \b \t \n \f \r (others below U+0020 as \u00xx), and emit
// every other code point as raw UTF-8. Notably it does NOT escape <, >, &, or /.
func encodeJSONString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\t':
			b.WriteString(`\t`)
		case '\n':
			b.WriteString(`\n`)
		case '\f':
			b.WriteString(`\f`)
		case '\r':
			b.WriteString(`\r`)
		default:
			if r < 0x20 {
				fmt.Fprintf(&b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
	return b.String()
}

// lessUTF16 compares two strings by UTF-16 code unit, matching JS string
// ordering (and RFC 8785 key ordering). For the BMP it coincides with code-point
// and UTF-8 byte order; it differs only for astral characters, which never occur
// in canonical keys — comparing UTF-16 units keeps parity unconditional anyway.
func lessUTF16(a, b string) bool {
	au := utf16.Encode([]rune(a))
	bu := utf16.Encode([]rune(b))
	for i := 0; i < len(au) && i < len(bu); i++ {
		if au[i] != bu[i] {
			return au[i] < bu[i]
		}
	}
	return len(au) < len(bu)
}

func normalizePaths(paths []string, workspaceRoot string) []string {
	out := make([]string, 0, len(paths))
	for _, p := range paths {
		out = append(out, normalizeOnePath(p, workspaceRoot))
	}
	sort.Slice(out, func(i, j int) bool { return lessUTF16(out[i], out[j]) })
	return out
}

func normalizeOnePath(p, workspaceRoot string) string {
	// Separator-normalize to forward slashes first so Windows and POSIX agree.
	s := strings.ReplaceAll(p, "\\", "/")
	if workspaceRoot != "" {
		root := strings.ReplaceAll(workspaceRoot, "\\", "/")
		switch {
		case s == root:
			s = ""
		case strings.HasPrefix(s, root+"/"):
			s = s[len(root)+1:]
		}
	}
	if s == "" {
		return ""
	}
	// path.Clean is Go's slash-based normalizer; it collapses `.`/`..` segments
	// like posix.normalize. (posix.normalize("") -> "." is handled above by the
	// empty-string guard, matching the TS branch.)
	return path.Clean(s)
}

func normalizeShellCommand(cmd string) string {
	// Collapse runs of whitespace to a single space and trim. The command VALUE
	// is identity; incidental spacing is not. strings.Fields splits on any Unicode
	// whitespace run, matching the TS /\s+/ collapse, then we rejoin with one space.
	return strings.Join(strings.Fields(cmd), " ")
}

func redactSecrets(args map[string]any, secretKeys []string) map[string]any {
	if len(secretKeys) == 0 {
		return args
	}
	secret := make(map[string]struct{}, len(secretKeys))
	for _, k := range secretKeys {
		secret[k] = struct{}{}
	}
	out := make(map[string]any, len(args))
	for k, v := range args {
		if _, ok := secret[k]; ok {
			redacted, err := redactValue(v)
			if err != nil {
				// A non-canonical secret value is a programming error in the caller;
				// surface it as the sentinel so it can never masquerade as a real
				// digest, rather than panicking inside canonicalization.
				out[k] = "sha256:error"
				continue
			}
			out[k] = redacted
		} else {
			out[k] = v
		}
	}
	return out
}

// redactValue is redact-but-stable: a SHA-256 digest keeps the canonical form
// stable across runs without ever placing the secret in cleartext. This is NOT
// the approval fingerprint (an HMAC keyed on a Stigmer secret); this digest is
// unkeyed redaction only. Mirrors redactValue in TS.
func redactValue(v any) (string, error) {
	var material string
	if s, ok := v.(string); ok {
		material = s
	} else {
		j, err := canonicalJSON(v)
		if err != nil {
			return "", err
		}
		material = j
	}
	sum := sha256.Sum256([]byte(material))
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}
