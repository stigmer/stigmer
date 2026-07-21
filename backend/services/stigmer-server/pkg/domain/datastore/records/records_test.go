package records

import (
	"strings"
	"testing"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func bookingsCollection() *datastorev1.CollectionDeclaration {
	return &datastorev1.CollectionDeclaration{
		Name: "bookings",
		Fields: []*datastorev1.FieldDeclaration{
			{Name: "slot_start", Type: datastorev1.FieldType_timestamp, Required: true},
			{Name: "patient_name", Type: datastorev1.FieldType_string, Required: true},
			{Name: "patient_phone", Type: datastorev1.FieldType_string},
			{Name: "status", Type: datastorev1.FieldType_string, Required: true,
				Default: structpb.NewStringValue("confirmed"), EnumValues: []string{"confirmed", "cancelled"}},
			{Name: "notes", Type: datastorev1.FieldType_json},
		},
	}
}

func TestBuildInsertFields(t *testing.T) {
	coll := bookingsCollection()

	t.Run("canonicalizes, applies defaults, enforces required", func(t *testing.T) {
		fields, err := BuildInsertFields(coll, map[string]any{
			"slot_start":   "2026-07-21T10:00:00+05:30",
			"patient_name": "Asha",
		})
		require.NoError(t, err)
		assert.Equal(t, "2026-07-21T04:30:00.000000000Z", fields["slot_start"], "offset normalized to canonical UTC")
		assert.Equal(t, "confirmed", fields["status"], "default applied")
		_, hasPhone := fields["patient_phone"]
		assert.False(t, hasPhone, "absent optional field stays absent")
	})

	t.Run("missing required field rejected", func(t *testing.T) {
		_, err := BuildInsertFields(coll, map[string]any{"slot_start": "2026-07-21T04:30:00Z"})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `field "patient_name" is required`)
	})

	t.Run("system field rejected", func(t *testing.T) {
		_, err := BuildInsertFields(coll, map[string]any{"created_by": "me"})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `server-managed`)
	})

	t.Run("undeclared field rejected", func(t *testing.T) {
		_, err := BuildInsertFields(coll, map[string]any{"nonsense": 1.0})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `field "nonsense" is not declared`)
	})

	t.Run("explicit null on optional field is dropped", func(t *testing.T) {
		fields, err := BuildInsertFields(coll, map[string]any{
			"slot_start": "2026-07-21T04:30:00Z", "patient_name": "Asha", "patient_phone": nil,
		})
		require.NoError(t, err)
		_, hasPhone := fields["patient_phone"]
		assert.False(t, hasPhone)
	})

	t.Run("explicit null on required field without default rejected", func(t *testing.T) {
		_, err := BuildInsertFields(coll, map[string]any{
			"slot_start": "2026-07-21T04:30:00Z", "patient_name": nil,
		})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `field "patient_name" is required`)
	})
}

func TestMergeUpdateFields(t *testing.T) {
	coll := bookingsCollection()
	stored := map[string]any{
		"slot_start":    "2026-07-21T04:30:00.000000000Z",
		"patient_name":  "Asha",
		"patient_phone": "9198",
		"status":        "confirmed",
	}

	t.Run("only supplied fields change", func(t *testing.T) {
		merged, err := MergeUpdateFields(coll, stored, map[string]any{"status": "cancelled"})
		require.NoError(t, err)
		assert.Equal(t, "cancelled", merged["status"])
		assert.Equal(t, "Asha", merged["patient_name"], "unsupplied fields preserved")
	})

	t.Run("explicit null clears an optional field", func(t *testing.T) {
		merged, err := MergeUpdateFields(coll, stored, map[string]any{"patient_phone": nil})
		require.NoError(t, err)
		_, has := merged["patient_phone"]
		assert.False(t, has)
	})

	t.Run("required field cannot be cleared", func(t *testing.T) {
		_, err := MergeUpdateFields(coll, stored, map[string]any{"patient_name": nil})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `cannot be cleared`)
	})

	t.Run("merge validates enum membership", func(t *testing.T) {
		_, err := MergeUpdateFields(coll, stored, map[string]any{"status": "pending"})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `must be one of`)
	})
}

func TestTypedFields_ProjectsRemovedFieldsOut(t *testing.T) {
	coll := bookingsCollection()
	stored := map[string]any{
		"patient_name":  "Asha",
		"legacy_column": "retained invisibly", // no longer declared
	}
	typed, err := TypedFields(coll, stored)
	require.NoError(t, err)
	_, has := typed["legacy_column"]
	assert.False(t, has, "undeclared stored data must never surface")
	assert.Equal(t, "Asha", typed["patient_name"])
}

func TestNewRecord_StampsSystemFields(t *testing.T) {
	rec := NewRecord(identity.LocalSubject(), "stigmer", map[string]any{"k": "v"})
	assert.True(t, strings.HasPrefix(rec.ID, "dsr_"), "record ids carry the dsr prefix, got %s", rec.ID)
	assert.Equal(t, "principal/identity_account/system", rec.CreatedByKey)
	assert.Equal(t, "stigmer", rec.Org)
	assert.False(t, rec.CreatedAt.IsZero())
	assert.Equal(t, rec.CreatedAt, rec.UpdatedAt)
}

func TestEnvelope_ProjectsCanonicalStruct(t *testing.T) {
	coll := bookingsCollection()
	rec := NewRecord(identity.LocalSubject(), "stigmer", map[string]any{
		"slot_start":   "2026-07-21T04:30:00.000000000Z",
		"patient_name": "Asha",
		"status":       "confirmed",
	})
	envelope, err := Envelope(coll, rec)
	require.NoError(t, err)
	assert.Equal(t, rec.ID, envelope.GetId())
	assert.Equal(t, "Asha", envelope.GetFields().GetFields()["patient_name"].GetStringValue())
	assert.NotNil(t, envelope.GetCreatedBy().GetPrincipal())
	_, hasPhone := envelope.GetFields().GetFields()["patient_phone"]
	assert.False(t, hasPhone, "absent fields are omitted, not nulled")
}

// --- filter building (the per-type operator matrix) ----------------------

func filterColl() *datastorev1.CollectionDeclaration {
	return &datastorev1.CollectionDeclaration{
		Name: "bookings",
		Fields: []*datastorev1.FieldDeclaration{
			{Name: "status", Type: datastorev1.FieldType_string, Required: true, EnumValues: []string{"confirmed", "cancelled"}},
			{Name: "slot_start", Type: datastorev1.FieldType_timestamp, Required: true},
			{Name: "priority", Type: datastorev1.FieldType_integer},
			{Name: "vip", Type: datastorev1.FieldType_bool},
			{Name: "notes", Type: datastorev1.FieldType_json},
		},
	}
}

func condition(field string, op datastorev1.RecordConditionOp, value any) *datastorev1.RecordCondition {
	c := &datastorev1.RecordCondition{Field: field, Op: op}
	if value != nil {
		v, err := structpb.NewValue(value)
		if err != nil {
			panic(err)
		}
		c.Value = v
	}
	return c
}

func TestBuildConditions(t *testing.T) {
	coll := filterColl()

	t.Run("valid conditions canonicalize values", func(t *testing.T) {
		conds, err := BuildConditions(coll, &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{
			condition("status", datastorev1.RecordConditionOp_eq, "confirmed"),
			condition("slot_start", datastorev1.RecordConditionOp_gte, "2026-07-21T00:00:00Z"),
			condition("priority", datastorev1.RecordConditionOp_lt, 5.0),
		}})
		require.NoError(t, err)
		require.Len(t, conds, 3)
		assert.Equal(t, "2026-07-21T00:00:00.000000000Z", conds[1].Value, "filter values use canonical encodings")
		assert.Equal(t, int64(5), conds[2].Value)
	})

	rejections := []struct {
		name    string
		cond    *datastorev1.RecordCondition
		wantErr string
	}{
		{"undeclared field", condition("nonsense", datastorev1.RecordConditionOp_eq, "x"),
			`field "nonsense" is not declared`},
		{"range op on string", condition("status", datastorev1.RecordConditionOp_gt, "confirmed"),
			`operator gt is not valid for field "status"`},
		{"membership op on bool", condition("vip", datastorev1.RecordConditionOp_is_in, nil),
			`operator is_in is not valid for field "vip"`},
		{"json not filterable", condition("notes", datastorev1.RecordConditionOp_eq, "x"),
			`type json is not filterable`},
		{"created_by not filterable", condition("created_by", datastorev1.RecordConditionOp_eq, "x"),
			`field "created_by" is not filterable`},
		{"is_null on required field", condition("status", datastorev1.RecordConditionOp_is_null, nil),
			`required and can never be null`},
		{"enum value outside the set", condition("status", datastorev1.RecordConditionOp_eq, "pending"),
			`must be one of`},
		{"scalar op without a value", condition("status", datastorev1.RecordConditionOp_eq, nil),
			`requires a value`},
		{"id with a range operator", condition("id", datastorev1.RecordConditionOp_gt, "dsr_x"),
			`id supports only eq and is_in`},
		{"created_at with eq", condition("created_at", datastorev1.RecordConditionOp_eq, "2026-07-21T00:00:00Z"),
			`created_at supports only range operators`},
		{"created_at with a non-timestamp value", condition("created_at", datastorev1.RecordConditionOp_gte, "yesterday"),
			`require RFC 3339 timestamp strings`},
	}
	for _, tt := range rejections {
		t.Run(tt.name, func(t *testing.T) {
			_, err := BuildConditions(coll, &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{tt.cond}})
			require.Error(t, err)
			assert.Contains(t, status.Convert(err).Message(), tt.wantErr)
		})
	}

	t.Run("is_in requires values", func(t *testing.T) {
		_, err := BuildConditions(coll, &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{
			{Field: "status", Op: datastorev1.RecordConditionOp_is_in},
		}})
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `requires values`)
	})

	t.Run("is_null on optional field allowed", func(t *testing.T) {
		conds, err := BuildConditions(coll, &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{
			condition("priority", datastorev1.RecordConditionOp_is_null, nil),
		}})
		require.NoError(t, err)
		assert.Equal(t, datastorev1.RecordConditionOp_is_null, conds[0].Op)
	})

	t.Run("system conditions marked System", func(t *testing.T) {
		conds, err := BuildConditions(coll, &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{
			condition("id", datastorev1.RecordConditionOp_eq, "dsr_x"),
			condition("created_at", datastorev1.RecordConditionOp_gte, "2026-07-21T00:00:00Z"),
		}})
		require.NoError(t, err)
		assert.True(t, conds[0].System)
		assert.True(t, conds[1].System)
		assert.Equal(t, "2026-07-21T00:00:00.000000000Z", conds[1].Value)
	})
}

func TestBuildOrderBy(t *testing.T) {
	coll := filterColl()

	t.Run("nil keeps the default ordering", func(t *testing.T) {
		ob, err := BuildOrderBy(coll, nil)
		require.NoError(t, err)
		assert.Nil(t, ob)
	})

	t.Run("declared field with direction", func(t *testing.T) {
		ob, err := BuildOrderBy(coll, &datastorev1.RecordOrderBy{
			Field: "priority", Direction: datastorev1.RecordSortDirection_desc,
		})
		require.NoError(t, err)
		assert.Equal(t, "priority", ob.Field)
		assert.True(t, ob.Descending)
		assert.False(t, ob.System)
	})

	t.Run("system field", func(t *testing.T) {
		ob, err := BuildOrderBy(coll, &datastorev1.RecordOrderBy{Field: "created_at"})
		require.NoError(t, err)
		assert.True(t, ob.System)
		assert.False(t, ob.Descending, "unset direction defaults to ascending")
	})

	t.Run("json not sortable", func(t *testing.T) {
		_, err := BuildOrderBy(coll, &datastorev1.RecordOrderBy{Field: "notes"})
		require.Error(t, err)
	})

	t.Run("created_by not sortable", func(t *testing.T) {
		_, err := BuildOrderBy(coll, &datastorev1.RecordOrderBy{Field: "created_by"})
		require.Error(t, err)
	})
}

func TestNormalizeLimit(t *testing.T) {
	assert.Equal(t, DefaultFindLimit, NormalizeLimit(0))
	assert.Equal(t, 1, NormalizeLimit(1))
	assert.Equal(t, MaxFindLimit, NormalizeLimit(100))
	assert.Equal(t, MaxFindLimit, NormalizeLimit(500), "defense in depth beyond the proto cap")
}
