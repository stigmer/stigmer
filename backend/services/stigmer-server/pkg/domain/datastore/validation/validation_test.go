package validation

import (
	"testing"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// validSpec returns a minimal valid spec test cases mutate into
// violations. The shape mirrors the clinic worked example.
func validSpec() *datastorev1.DatastoreSpec {
	return &datastorev1.DatastoreSpec{
		Timezone: "Asia/Kolkata",
		Authorization: &datastorev1.DatastoreAuthorization{
			Roles: []*datastorev1.DatastoreRole{{Name: "admin"}, {Name: "patient"}},
			Bindings: []*datastorev1.DatastoreRoleBinding{{
				Subject: &datastorev1.DatastoreSubject{
					Kind: &datastorev1.DatastoreSubject_ChannelSender{
						ChannelSender: &datastorev1.ChannelSenderSubject{SenderKind: "whatsapp_phone", Value: "9198"},
					},
				},
				Role: "admin",
			}},
			DefaultRole: "patient",
		},
		Collections: []*datastorev1.CollectionDeclaration{
			{
				Name: "schedules",
				Fields: []*datastorev1.FieldDeclaration{
					{Name: "day_of_week", Type: datastorev1.FieldType_integer, Required: true},
					{Name: "session_start", Type: datastorev1.FieldType_time, Required: true},
				},
				Grants: []*datastorev1.DatastoreGrant{
					{Role: "patient", Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read}},
				},
			},
			{
				Name: "bookings",
				Fields: []*datastorev1.FieldDeclaration{
					{Name: "slot_start", Type: datastorev1.FieldType_timestamp, Required: true},
					{Name: "status", Type: datastorev1.FieldType_string, EnumValues: []string{"confirmed", "cancelled"},
						Default: structpb.NewStringValue("confirmed")},
				},
				Uniques: []*datastorev1.UniqueConstraint{{
					Name:    "one_confirmed_per_slot",
					Fields:  []string{"slot_start"},
					Where:   &datastorev1.UniqueWhere{Field: "status", Equals: structpb.NewStringValue("confirmed")},
					Message: "that slot is already booked",
				}},
				Checks: []*datastorev1.CheckConstraint{{
					Name:       "half_hour_grid",
					Expression: "this.slot_start.getMinutes(tz) in [0, 30]",
					Message:    "appointments start on the half hour",
				}},
				Exists: []*datastorev1.ExistsConstraint{{
					Name:       "inside_clinic_hours",
					Collection: "schedules",
					Where:      "that.day_of_week == this.slot_start.getDayOfWeek(tz)",
					Message:    "that time is outside clinic hours",
				}},
			},
		},
	}
}

func TestValidateSpec_ValidClinicShapedSpec(t *testing.T) {
	require.NoError(t, ValidateSpec(validSpec()))
}

func TestValidateSpec_NilSpecIsValid(t *testing.T) {
	require.NoError(t, ValidateSpec(nil))
}

func TestValidateSpec_Violations(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*datastorev1.DatastoreSpec)
		wantErr string
	}{
		{
			name:    "invalid IANA timezone",
			mutate:  func(s *datastorev1.DatastoreSpec) { s.Timezone = "Mars/Olympus" },
			wantErr: `timezone "Mars/Olympus" is not a valid IANA timezone`,
		},
		{
			name: "duplicate collection name",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections = append(s.Collections, s.Collections[0])
			},
			wantErr: `duplicate collection name "schedules"`,
		},
		{
			name: "duplicate field name",
			mutate: func(s *datastorev1.DatastoreSpec) {
				c := s.Collections[0]
				c.Fields = append(c.Fields, c.Fields[0])
			},
			wantErr: `collection "schedules" declares field "day_of_week" more than once`,
		},
		{
			name: "duplicate constraint name across classes",
			mutate: func(s *datastorev1.DatastoreSpec) {
				c := s.Collections[1]
				c.Checks = append(c.Checks, &datastorev1.CheckConstraint{
					Name: "one_confirmed_per_slot", Expression: "true", Message: "m",
				})
			},
			wantErr: `collection "bookings" declares constraint "one_confirmed_per_slot" more than once`,
		},
		{
			name: "duplicate role name",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Authorization.Roles = append(s.Authorization.Roles, &datastorev1.DatastoreRole{Name: "admin"})
			},
			wantErr: `duplicate role name "admin"`,
		},
		{
			name: "binding references undeclared role",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Authorization.Bindings[0].Role = "superuser"
			},
			wantErr: `binding references undeclared role "superuser"`,
		},
		{
			name: "default_role references undeclared role",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Authorization.DefaultRole = "visitor"
			},
			wantErr: `default_role references undeclared role "visitor"`,
		},
		{
			name: "grant references undeclared role",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[0].Grants[0].Role = "nurse"
			},
			wantErr: `grant in collection "schedules" references undeclared role "nurse"`,
		},
		{
			name: "default incompatible with declared type",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[0].Fields[0].Default = structpb.NewStringValue("monday")
			},
			wantErr: `field "day_of_week" default is incompatible with type integer`,
		},
		{
			name: "default outside enum_values",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Fields[1].Default = structpb.NewStringValue("pending")
			},
			wantErr: `field "status" default is incompatible with type string`,
		},
		{
			name: "null default rejected with guidance",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[0].Fields[0].Default = structpb.NewNullValue()
			},
			wantErr: `declares a null default; omit the default instead`,
		},
		{
			name: "unique references undeclared field",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Uniques[0].Fields = []string{"slot_end"}
			},
			wantErr: `unique constraint "one_confirmed_per_slot" in collection "bookings" references undeclared field "slot_end"`,
		},
		{
			name: "unique where.equals must canonicalize against its field",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Uniques[0].Where.Equals = structpb.NewNumberValue(1)
			},
			wantErr: `where.equals`,
		},
		{
			name: "exists references undeclared collection",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Exists[0].Collection = "holidays"
			},
			wantErr: `exists constraint "inside_clinic_hours" in collection "bookings" references undeclared collection "holidays"`,
		},
		{
			name: "tz reference without a declared timezone",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Timezone = ""
			},
			wantErr: `references tz but the datastore declares no timezone`,
		},
		{
			name: "check expression fails CEL compilation",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Checks[0].Expression = "this.slot_start >==< 5"
			},
			wantErr: `constraint "half_hour_grid" in collection "bookings" has an invalid expression`,
		},
		{
			name: "check expression must not reference that",
			mutate: func(s *datastorev1.DatastoreSpec) {
				s.Collections[1].Checks[0].Expression = "that.day_of_week == 1"
			},
			wantErr: `has an invalid expression`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			spec := validSpec()
			tt.mutate(spec)
			err := ValidateSpec(spec)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErr)
		})
	}
}

// TestReferencesTz pins the tokenizer-level scan: identifiers only,
// string literals excluded.
func TestReferencesTz(t *testing.T) {
	tests := []struct {
		expr string
		want bool
	}{
		{"timeOfDay(this.t, tz) == '10:00:00'", true},
		{"tz == 'UTC'", true},
		{"this.tz_offset > 0", false},             // part of a longer identifier
		{"this.quartz == 'mineral'", false},       // suffix of an identifier
		{"this.status == 'tz'", false},            // inside a string literal
		{"this.note == \"about tz\"", false},      // inside a double-quoted literal
		{"this.a == 'x' && tz == 'UTC'", true},    // after a closed literal
		{"localDate(this.t, tz) == this.d", true}, // argument position
		{"this.day_of_week >= 0", false},          // no tz at all
	}
	for _, tt := range tests {
		t.Run(tt.expr, func(t *testing.T) {
			assert.Equal(t, tt.want, referencesTz(tt.expr))
		})
	}
}
