//go:build integration

// Field-scoped read grants (DatastoreGrant.read_fields), end to end
// over the wire: a session-bound channel sender whose read grant
// carries a column allowlist must receive projected envelopes from
// every record RPC (find results AND write echoes), must not receive
// the created_by attribution subject, and must be refused filter
// conditions and order_by on hidden fields — the existence-oracle
// guard. The unit layers prove the algorithm per edition
// (authz/records in OSS, RecordGrants/Records in cloud); this suite
// proves the composed chain against the real control plane, Mongo
// session graph, and records Postgres, with byte-exact contract
// assertions. Closes dont-dos/002 (scope-all reads carry PII).
package integration

import (
	"context"
	"testing"
	"time"

	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// Projection denial texts — cross-edition contract bytes (the OSS
// records/filter.go and the cloud RecordFilters.java emit them
// byte-identically), with the INVALID_FILTER ErrorInfo reason.
const (
	hiddenFieldConditionDenied = `field "patient_name" is not readable under your grant` +
		` and cannot be used in filter conditions`
	hiddenFieldOrderByDenied = `field "patient_name" is not readable under your grant` +
		` and cannot be used in order_by`
	recordsReasonInvalidFilter = "INVALID_FILTER"
)

// readFieldsSpec is the clinic patient posture distilled: patients may
// see slot occupancy (slot_start, status) — never who booked — while
// the staff role reads everything. No default_role: every allowed call
// proves a binding resolved.
func readFieldsSpec() *datastorev1.DatastoreSpec {
	channelBinding := func(waID, role string) *datastorev1.DatastoreRoleBinding {
		return &datastorev1.DatastoreRoleBinding{
			Subject: &datastorev1.DatastoreSubject{
				Kind: &datastorev1.DatastoreSubject_ChannelSender{
					ChannelSender: &datastorev1.ChannelSenderSubject{
						SenderKind: harness.SenderKindWhatsAppPhone,
						Value:      waID,
					},
				},
			},
			Role: role,
		}
	}
	return &datastorev1.DatastoreSpec{
		Description: "read_fields projection integration fixture",
		Timezone:    "Asia/Kolkata",
		Authorization: &datastorev1.DatastoreAuthorization{
			Roles: []*datastorev1.DatastoreRole{{Name: "patient"}, {Name: "staff"}},
			Bindings: []*datastorev1.DatastoreRoleBinding{
				channelBinding(senderPatientA, "patient"),
				channelBinding(senderReadonly, "staff"),
			},
		},
		Collections: []*datastorev1.CollectionDeclaration{{
			Name:        bookingsCollection,
			Description: "Patient appointments",
			Fields: []*datastorev1.FieldDeclaration{
				{Name: "slot_start", Type: datastorev1.FieldType_timestamp, Required: true},
				{Name: "patient_name", Type: datastorev1.FieldType_string, Required: true},
				{Name: "status", Type: datastorev1.FieldType_string, Required: true,
					Default:    structpb.NewStringValue("confirmed"),
					EnumValues: []string{"confirmed", "cancelled"}},
			},
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient",
					Verbs: []datastorev1.DatastoreVerb{
						datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert},
					ReadFields: []string{"slot_start", "status"}},
				{Role: "patient",
					Verbs: []datastorev1.DatastoreVerb{
						datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete},
					Scope: datastorev1.DatastoreGrantScope_own},
				{Role: "staff", Verbs: []datastorev1.DatastoreVerb{
					datastorev1.DatastoreVerb_read}},
			},
		}},
	}
}

// TestDatastoreRecordsReach_ReadFieldsProjection drives the projection
// through the full production path: sandbox JWT → reach chain →
// sender-identity subject → the grant layer's column projection on
// real Postgres.
func TestDatastoreRecordsReach_ReadFieldsProjection(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	base := harness.NewClients(grpcConn)

	ds := harness.CreateDatastore(t, ctx, base, "records-readfields", readFieldsSpec())
	slug := ds.GetMetadata().GetSlug()
	agent := harness.CreateAgent(t, ctx, base, "records-readfields-agent",
		"You are the read_fields projection integration fixture agent.",
		harness.WithDatastoreUsage(slug))
	inst, err := base.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "records-readfields-inst",
			Org:  harness.TestOrg,
		},
		Spec: &agentinstancev1.AgentInstanceSpec{AgentId: agent.GetMetadata().GetId()},
	})
	require.NoError(t, err, "create agent instance")

	patient := sessionRecordClients(t, ctx, base, inst.GetMetadata().GetId(), sessionCreator,
		harness.ChannelSenderMetadata(harness.SenderKindWhatsAppPhone, senderPatientA))
	staff := sessionRecordClients(t, ctx, base, inst.GetMetadata().GetId(), sessionCreator,
		harness.ChannelSenderMetadata(harness.SenderKindWhatsAppPhone, senderReadonly))

	var bookingID string

	t.Run("insert echo carries only readable fields, without created_by", func(t *testing.T) {
		env := insertBooking(t, ctx, patient, slug, "2026-07-21T04:30:00Z", "Asha")
		bookingID = env.GetId()
		fields := env.GetFields().GetFields()
		require.Contains(t, fields, "slot_start")
		require.Contains(t, fields, "status")
		require.NotContains(t, fields, "patient_name",
			"a caller never receives a field it cannot read, even one it just wrote")
		require.Nil(t, env.GetCreatedBy(),
			"created_by is the sender's phone number — the most direct PII in the envelope")
	})

	t.Run("find returns projected envelopes; staff sees everything", func(t *testing.T) {
		list := findBySlot(t, ctx, patient, slug, "2026-07-21T04:30:00Z")
		require.Len(t, list.GetRecords(), 1)
		rec := list.GetRecords()[0]
		require.NotContains(t, rec.GetFields().GetFields(), "patient_name")
		require.Nil(t, rec.GetCreatedBy(),
			"attribution is PII; a restricted grant must list created_by explicitly")

		staffList := findBySlot(t, ctx, staff, slug, "2026-07-21T04:30:00Z")
		require.Len(t, staffList.GetRecords(), 1)
		staffRec := staffList.GetRecords()[0]
		require.Contains(t, staffRec.GetFields().GetFields(), "patient_name",
			"the unrestricted staff grant is unaffected")
		require.NotNil(t, staffRec.GetCreatedBy(),
			"an unrestricted read grant exposes attribution as before")
	})

	t.Run("condition on a hidden field is refused (existence oracle)", func(t *testing.T) {
		_, err := patient.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  slug,
			Collection: bookingsCollection,
			Filter: &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{{
				Field: "patient_name",
				Op:    datastorev1.RecordConditionOp_eq,
				Value: structpb.NewStringValue("Asha"),
			}}},
		})
		st := requireRecordsDenied(t, err, codes.InvalidArgument, hiddenFieldConditionDenied)
		require.Equal(t, hiddenFieldConditionDenied, st.Message(),
			"the denial is exact contract bytes, not a substring")
		requireErrorInfo(t, err, recordsReasonInvalidFilter, nil)
	})

	t.Run("order_by on a hidden field is refused", func(t *testing.T) {
		_, err := patient.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  slug,
			Collection: bookingsCollection,
			OrderBy:    &datastorev1.RecordOrderBy{Field: "patient_name"},
		})
		st := requireRecordsDenied(t, err, codes.InvalidArgument, hiddenFieldOrderByDenied)
		require.Equal(t, hiddenFieldOrderByDenied, st.Message())
	})

	t.Run("update echo is projected too", func(t *testing.T) {
		env, err := patient.DatastoreRecordCommand.UpdateRecord(ctx, &datastorev1.UpdateRecordRequest{
			Datastore:  slug,
			Collection: bookingsCollection,
			Id:         bookingID,
			Fields:     mustRecordStruct(t, map[string]any{"status": "cancelled"}),
		})
		require.NoError(t, err, "own-scoped update of the patient's booking")
		require.Equal(t, "cancelled", env.GetFields().GetFields()["status"].GetStringValue())
		require.NotContains(t, env.GetFields().GetFields(), "patient_name")
	})

	t.Run("describe surfaces readable_fields on the read verb", func(t *testing.T) {
		desc, err := patient.DatastoreRecordQuery.DescribeDatastore(ctx, &datastorev1.DescribeDatastoreRequest{
			Datastore: slug,
		})
		require.NoError(t, err, "describe as the restricted patient")
		require.Len(t, desc.GetCollections(), 1)
		coll := desc.GetCollections()[0]
		require.Len(t, coll.GetFields(), 3,
			"the full field schema stays visible — writers must know a field exists to write it")
		require.NotEmpty(t, coll.GetAccess())
		read := coll.GetAccess()[0]
		require.Equal(t, datastorev1.DatastoreVerb_read, read.GetVerb())
		require.Equal(t, []string{"slot_start", "status"}, read.GetReadableFields(),
			"declaration order, the describe contract")

		staffDesc, err := staff.DatastoreRecordQuery.DescribeDatastore(ctx, &datastorev1.DescribeDatastoreRequest{
			Datastore: slug,
		})
		require.NoError(t, err, "describe as the unrestricted staff")
		staffRead := staffDesc.GetCollections()[0].GetAccess()[0]
		require.Empty(t, staffRead.GetReadableFields(),
			"unrestricted read carries no field list (empty means all)")
	})
}
