// Package schema implements the value semantics of declared datastore
// fields: canonical encodings, validation, coercion, and defaults.
//
// Everything above the storage layer (domain validation, record writes,
// filter type-checks, CEL constraint activation) speaks these canonical
// encodings, so they are defined exactly once here. The encodings are a
// cross-edition contract (DD-004): the Java implementation (T04) must
// produce byte-identical canonical values.
//
// Canonical encodings:
//   - string:    the string itself (enum_values membership checked)
//   - integer:   int64 (JSON numbers must be integral)
//   - number:    float64
//   - bool:      bool
//   - timestamp: RFC 3339 UTC, e.g. "2026-07-21T04:30:00Z"
//   - date:      "YYYY-MM-DD" (lexicographically chronological)
//   - time:      "HH:MM:SS" zero-padded (lexicographically chronological;
//     "HH:MM" input is canonicalized to "HH:MM:SS")
//   - json:      any JSON value, stored as-is (not constrainable or
//     filterable in v1)
package schema

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
)

// ReservedFieldNames are the record-envelope system field names (plus the
// cloud tenancy column) that can never be declared. The proto enforces the
// same set via CEL; this constant exists for domain code that validates
// write payloads and filters.
var ReservedFieldNames = map[string]bool{
	"id":         true,
	"created_at": true,
	"updated_at": true,
	"created_by": true,
	"org":        true,
}

// TimestampFormat is the canonical wire encoding of timestamp fields and
// of the record envelope's created_at/updated_at system columns. Fixed
// fractional width keeps encoded values lexicographically chronological
// (RFC3339Nano trims trailing zeros, which would break string ordering).
const TimestampFormat = "2006-01-02T15:04:05.000000000Z"

// CanonicalizeValue validates a caller-supplied field value against its
// declaration and returns the canonical Go representation (see package
// doc). The input is the JSON-shaped value produced by
// structpb.Value.AsInterface(): string, float64, bool, nil, []any, or
// map[string]any.
//
// A nil input means explicit null: valid for optional fields (clears the
// value), rejected for required fields by the caller (this function only
// canonicalizes; required-ness is write-path policy because updates only
// see the supplied subset).
func CanonicalizeValue(field *datastorev1.FieldDeclaration, v any) (any, error) {
	if v == nil {
		return nil, nil
	}

	name := field.GetName()
	switch field.GetType() {
	case datastorev1.FieldType_string:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("field %q must be a string", name)
		}
		if enums := field.GetEnumValues(); len(enums) > 0 {
			for _, e := range enums {
				if s == e {
					return s, nil
				}
			}
			return nil, fmt.Errorf("field %q must be one of %v", name, enums)
		}
		return s, nil

	case datastorev1.FieldType_integer:
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("field %q must be an integer", name)
		}
		if f != math.Trunc(f) || math.IsInf(f, 0) || math.IsNaN(f) {
			return nil, fmt.Errorf("field %q must be an integer, got %v", name, f)
		}
		return int64(f), nil

	case datastorev1.FieldType_number:
		f, ok := v.(float64)
		if !ok {
			return nil, fmt.Errorf("field %q must be a number", name)
		}
		return f, nil

	case datastorev1.FieldType_bool:
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("field %q must be a boolean", name)
		}
		return b, nil

	case datastorev1.FieldType_timestamp:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("field %q must be an RFC 3339 timestamp string", name)
		}
		t, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			return nil, fmt.Errorf("field %q must be an RFC 3339 timestamp (e.g. 2026-07-21T04:30:00Z)", name)
		}
		return t.UTC().Format(TimestampFormat), nil

	case datastorev1.FieldType_date:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("field %q must be a YYYY-MM-DD date string", name)
		}
		if _, err := time.Parse("2006-01-02", s); err != nil {
			return nil, fmt.Errorf("field %q must be a valid YYYY-MM-DD date", name)
		}
		return s, nil

	case datastorev1.FieldType_time:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("field %q must be an HH:MM[:SS] time string", name)
		}
		canonical, err := canonicalizeTime(s)
		if err != nil {
			return nil, fmt.Errorf("field %q must be a valid zero-padded HH:MM[:SS] time", name)
		}
		return canonical, nil

	case datastorev1.FieldType_json:
		return v, nil

	default:
		return nil, fmt.Errorf("field %q has unsupported type %s", name, field.GetType())
	}
}

// canonicalizeTime normalizes "HH:MM" to "HH:MM:SS" so all stored time
// values compare lexicographically. Input must already be zero-padded.
func canonicalizeTime(s string) (string, error) {
	switch len(s) {
	case 5: // HH:MM
		if _, err := time.Parse("15:04", s); err != nil {
			return "", err
		}
		return s + ":00", nil
	case 8: // HH:MM:SS
		if _, err := time.Parse("15:04:05", s); err != nil {
			return "", err
		}
		return s, nil
	default:
		return "", fmt.Errorf("invalid time literal %q", s)
	}
}

// FromStored re-types a value read back from storage into its canonical
// Go representation. The storage layer decodes JSON with UseNumber (so
// integers survive without float64 precision loss); this converts
// json.Number to int64/float64 per the declaration and passes canonical
// strings/bools through. Stored values were canonicalized on write, so a
// conversion failure indicates storage corruption, not caller error.
func FromStored(field *datastorev1.FieldDeclaration, v any) (any, error) {
	if v == nil {
		return nil, nil
	}
	if n, ok := v.(json.Number); ok {
		switch field.GetType() {
		case datastorev1.FieldType_integer:
			i, err := n.Int64()
			if err != nil {
				return nil, fmt.Errorf("stored value for integer field %q is corrupt: %w", field.GetName(), err)
			}
			return i, nil
		case datastorev1.FieldType_number:
			f, err := n.Float64()
			if err != nil {
				return nil, fmt.Errorf("stored value for number field %q is corrupt: %w", field.GetName(), err)
			}
			return f, nil
		case datastorev1.FieldType_json:
			// JSON escape-hatch numbers stay as float64 (structpb's shape).
			f, err := n.Float64()
			if err != nil {
				return nil, fmt.Errorf("stored value for json field %q is corrupt: %w", field.GetName(), err)
			}
			return f, nil
		default:
			return nil, fmt.Errorf("stored numeric value for %s field %q is corrupt", field.GetType(), field.GetName())
		}
	}
	if field.GetType() == datastorev1.FieldType_json {
		return normalizeStoredJSON(v), nil
	}
	return v, nil
}

// normalizeStoredJSON converts nested json.Number values (from the
// UseNumber decode) back to float64 so json fields round-trip to the
// structpb value space.
func normalizeStoredJSON(v any) any {
	switch val := v.(type) {
	case json.Number:
		f, err := val.Float64()
		if err != nil {
			return val.String()
		}
		return f
	case []any:
		out := make([]any, len(val))
		for i, item := range val {
			out[i] = normalizeStoredJSON(item)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(val))
		for k, item := range val {
			out[k] = normalizeStoredJSON(item)
		}
		return out
	default:
		return v
	}
}

// FieldByName returns the declaration of a named field, or nil.
func FieldByName(coll *datastorev1.CollectionDeclaration, name string) *datastorev1.FieldDeclaration {
	for _, f := range coll.GetFields() {
		if f.GetName() == name {
			return f
		}
	}
	return nil
}

// CollectionByName returns the declaration of a named collection, or nil.
func CollectionByName(spec *datastorev1.DatastoreSpec, name string) *datastorev1.CollectionDeclaration {
	for _, c := range spec.GetCollections() {
		if c.GetName() == name {
			return c
		}
	}
	return nil
}
