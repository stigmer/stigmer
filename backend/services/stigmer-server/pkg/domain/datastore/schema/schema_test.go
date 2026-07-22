package schema

import (
	"encoding/json"
	"testing"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func field(name string, t datastorev1.FieldType, enums ...string) *datastorev1.FieldDeclaration {
	return &datastorev1.FieldDeclaration{Name: name, Type: t, EnumValues: enums}
}

func TestCanonicalizeValue(t *testing.T) {
	tests := []struct {
		name    string
		field   *datastorev1.FieldDeclaration
		in      any
		want    any
		wantErr string
	}{
		// string + enum
		{name: "string passes through", field: field("s", datastorev1.FieldType_string), in: "hello", want: "hello"},
		{name: "enum member accepted", field: field("s", datastorev1.FieldType_string, "a", "b"), in: "b", want: "b"},
		{name: "enum non-member rejected", field: field("s", datastorev1.FieldType_string, "a", "b"), in: "c",
			wantErr: `must be one of [a b]`},
		{name: "string type mismatch", field: field("s", datastorev1.FieldType_string), in: 5.0,
			wantErr: `must be a string`},

		// integer (arrives as float64 from the structpb value space)
		{name: "integral float becomes int64", field: field("n", datastorev1.FieldType_integer), in: 42.0, want: int64(42)},
		{name: "fractional rejected for integer", field: field("n", datastorev1.FieldType_integer), in: 1.5,
			wantErr: `must be an integer`},
		{name: "integer type mismatch", field: field("n", datastorev1.FieldType_integer), in: "42",
			wantErr: `must be an integer`},

		// number
		{name: "number passes through", field: field("n", datastorev1.FieldType_number), in: 12.5, want: 12.5},

		// bool
		{name: "bool passes through", field: field("b", datastorev1.FieldType_bool), in: true, want: true},
		{name: "bool type mismatch", field: field("b", datastorev1.FieldType_bool), in: "true",
			wantErr: `must be a boolean`},

		// timestamp: canonicalized to fixed-width UTC
		{name: "timestamp offset normalized to UTC", field: field("t", datastorev1.FieldType_timestamp),
			in: "2026-07-21T10:00:00+05:30", want: "2026-07-21T04:30:00.000000000Z"},
		{name: "timestamp already UTC", field: field("t", datastorev1.FieldType_timestamp),
			in: "2026-07-21T04:30:00Z", want: "2026-07-21T04:30:00.000000000Z"},
		{name: "timestamp garbage rejected", field: field("t", datastorev1.FieldType_timestamp), in: "yesterday",
			wantErr: `must be an RFC 3339 timestamp`},

		// date
		{name: "date accepted", field: field("d", datastorev1.FieldType_date), in: "2026-07-21", want: "2026-07-21"},
		{name: "date invalid day rejected", field: field("d", datastorev1.FieldType_date), in: "2026-02-30",
			wantErr: `must be a valid YYYY-MM-DD date`},

		// time: HH:MM canonicalizes to HH:MM:SS
		{name: "HH:MM canonicalized", field: field("t", datastorev1.FieldType_time), in: "10:00", want: "10:00:00"},
		{name: "HH:MM:SS accepted", field: field("t", datastorev1.FieldType_time), in: "10:00:30", want: "10:00:30"},
		{name: "unpadded time rejected", field: field("t", datastorev1.FieldType_time), in: "9:00",
			wantErr: `must be a valid zero-padded HH:MM[:SS] time`},
		{name: "out of range time rejected", field: field("t", datastorev1.FieldType_time), in: "25:00",
			wantErr: `must be a valid zero-padded HH:MM[:SS] time`},

		// json escape hatch
		{name: "json stores any shape", field: field("j", datastorev1.FieldType_json),
			in: map[string]any{"k": []any{1.0, "x"}}, want: map[string]any{"k": []any{1.0, "x"}}},

		// explicit null
		{name: "nil stays nil", field: field("s", datastorev1.FieldType_string), in: nil, want: nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CanonicalizeValue(tt.field, tt.in)
			if tt.wantErr != "" {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestFromStored_RetypesJSONNumbers(t *testing.T) {
	i, err := FromStored(field("n", datastorev1.FieldType_integer), json.Number("9007199254740993"))
	require.NoError(t, err)
	assert.Equal(t, int64(9007199254740993), i, "beyond 2^53, exact")

	f, err := FromStored(field("n", datastorev1.FieldType_number), json.Number("12.5"))
	require.NoError(t, err)
	assert.Equal(t, 12.5, f)

	s, err := FromStored(field("s", datastorev1.FieldType_string), "hello")
	require.NoError(t, err)
	assert.Equal(t, "hello", s)

	nested, err := FromStored(field("j", datastorev1.FieldType_json),
		map[string]any{"n": json.Number("2"), "list": []any{json.Number("3")}})
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"n": 2.0, "list": []any{3.0}}, nested,
		"json escape-hatch numbers normalize to float64 (the structpb shape)")

	_, err = FromStored(field("s", datastorev1.FieldType_string), json.Number("5"))
	require.Error(t, err, "a numeric stored value for a string field is corruption, not coercion")
}

func TestTimestampFormat_LexicographicIsChronologic(t *testing.T) {
	// The fixed fractional width is the property everything else leans
	// on (ordering indexes, range filters); RFC3339Nano would break it.
	early, err := CanonicalizeValue(field("t", datastorev1.FieldType_timestamp), "2026-07-21T04:30:00.5Z")
	require.NoError(t, err)
	late, err := CanonicalizeValue(field("t", datastorev1.FieldType_timestamp), "2026-07-21T04:30:00.25Z")
	require.NoError(t, err)
	assert.Greater(t, early.(string), late.(string),
		"0.5s must sort after 0.25s as strings — fixed-width encoding")
}
