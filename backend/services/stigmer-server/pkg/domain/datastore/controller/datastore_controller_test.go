package controller

import (
	"context"
	"path/filepath"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schemasync"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// testContext simulates the apiresource interceptor's kind injection,
// which the generic pipeline steps (Persist, BuildNewState, ...) read.
func testContext() context.Context {
	return context.WithValue(context.Background(),
		apiresourceinterceptor.ApiResourceKindKey, apiresourcekind.ApiResourceKind_datastore)
}

type testEnv struct {
	controller       *DatastoreController
	recordController *DatastoreRecordController
	store            store.Store
	recordStore      recordstore.Store
}

// setupTest wires both controllers over one shared database file — the
// production topology (core resource store and record substrate share
// stigmer.db through separate handles).
func setupTest(t *testing.T) *testEnv {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "stigmer.db")

	resourceStore, err := sqlite.NewStore(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { resourceStore.Close() })

	recordStore, err := recordstore.NewSQLiteStore(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { recordStore.Close() })

	return &testEnv{
		controller:       NewDatastoreController(resourceStore, recordStore),
		recordController: NewDatastoreRecordController(resourceStore, recordStore),
		store:            resourceStore,
		recordStore:      recordStore,
	}
}

// clinicDatastore is the acceptance shape (spec §9): schedules with
// seeds, bookings with a partial unique, a check, an exists, and a
// not_exists, and record-layer authorization granting the local
// operator (via default_role) full access to bookings but read-only
// schedules... except "admin" which the tests bind explicitly.
func clinicDatastore(name string) *datastorev1.Datastore {
	seed := func(fields map[string]any) *structpb.Struct {
		s, err := structpb.NewStruct(fields)
		if err != nil {
			panic(err)
		}
		return s
	}
	return &datastorev1.Datastore{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Datastore",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  identity.SystemOrg,
		},
		Spec: &datastorev1.DatastoreSpec{
			Description: "clinic records",
			Timezone:    "Asia/Kolkata",
			Authorization: &datastorev1.DatastoreAuthorization{
				Roles:       []*datastorev1.DatastoreRole{{Name: "operator"}},
				DefaultRole: "operator",
			},
			Collections: []*datastorev1.CollectionDeclaration{
				{
					Name: "schedules",
					Fields: []*datastorev1.FieldDeclaration{
						{Name: "day_of_week", Type: datastorev1.FieldType_integer, Required: true},
						{Name: "session_start", Type: datastorev1.FieldType_time, Required: true},
						{Name: "session_end", Type: datastorev1.FieldType_time, Required: true},
					},
					Checks: []*datastorev1.CheckConstraint{{
						Name:       "start_before_end",
						Expression: "this.session_start < this.session_end",
						Message:    "a session must start before it ends",
					}},
					Grants: []*datastorev1.DatastoreGrant{{
						Role:  "operator",
						Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read},
					}},
					SeedRecords: []*structpb.Struct{
						// Tuesday morning session, 10:00–13:00 IST.
						seed(map[string]any{"day_of_week": 2, "session_start": "10:00", "session_end": "13:00"}),
					},
				},
				{
					Name: "schedule_exceptions",
					Fields: []*datastorev1.FieldDeclaration{
						{Name: "exception_date", Type: datastorev1.FieldType_date, Required: true},
					},
					Grants: []*datastorev1.DatastoreGrant{{
						Role:  "operator",
						Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert},
					}},
				},
				{
					Name: "bookings",
					Fields: []*datastorev1.FieldDeclaration{
						{Name: "slot_start", Type: datastorev1.FieldType_timestamp, Required: true},
						{Name: "patient_name", Type: datastorev1.FieldType_string, Required: true},
						{Name: "status", Type: datastorev1.FieldType_string, Required: true,
							Default: structpb.NewStringValue("confirmed"), EnumValues: []string{"confirmed", "cancelled"}},
					},
					Uniques: []*datastorev1.UniqueConstraint{{
						Name:    "one_confirmed_per_slot",
						Fields:  []string{"slot_start"},
						Where:   &datastorev1.UniqueWhere{Field: "status", Equals: structpb.NewStringValue("confirmed")},
						Message: "that slot is already booked",
					}},
					Checks: []*datastorev1.CheckConstraint{{
						Name:       "half_hour_grid",
						Expression: "this.slot_start.getMinutes(tz) in [0, 30] && this.slot_start.getSeconds() == 0",
						Message:    "appointments start on the half hour",
					}},
					Exists: []*datastorev1.ExistsConstraint{{
						Name:       "inside_clinic_hours",
						When:       "this.status == 'confirmed'",
						Collection: "schedules",
						Where: "that.day_of_week == this.slot_start.getDayOfWeek(tz)" +
							" && timeOfDay(this.slot_start, tz) >= that.session_start" +
							" && timeOfDay(this.slot_start, tz) < that.session_end",
						Message: "that time is outside clinic hours",
					}},
					NotExists: []*datastorev1.ExistsConstraint{{
						Name:       "not_on_closed_date",
						When:       "this.status == 'confirmed'",
						Collection: "schedule_exceptions",
						Where:      "that.exception_date == localDate(this.slot_start, tz)",
						Message:    "the clinic is closed at that time",
					}},
					Grants: []*datastorev1.DatastoreGrant{{
						Role: "operator",
						Verbs: []datastorev1.DatastoreVerb{
							datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert,
							datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete,
						},
					}},
				},
			},
		},
	}
}

// tuesdaySlot is 10:30 IST (05:00Z) on Tuesday 2026-07-21 — inside the
// seeded Tuesday session and on the half-hour grid.
const tuesdaySlot = "2026-07-21T05:00:00Z"

func insertBooking(t *testing.T, env *testEnv, ds, slot, patient string) (*datastorev1.RecordEnvelope, error) {
	t.Helper()
	record, err := structpb.NewStruct(map[string]any{"slot_start": slot, "patient_name": patient})
	require.NoError(t, err)
	return env.recordController.InsertRecord(testContext(), &datastorev1.InsertRecordRequest{
		Datastore: ds, Collection: "bookings", Record: record,
	})
}

// --- resource lifecycle ----------------------------------------------------

func TestCreate_MaterializesSchemaAndSeeds(t *testing.T) {
	env := setupTest(t)

	created, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)
	assert.Equal(t, "clinic", created.GetMetadata().GetSlug())
	assert.Contains(t, created.GetMetadata().GetId(), "dst_")

	st := created.GetStatus()
	require.NotNil(t, st)
	assert.Equal(t, datastorev1.DatastoreSyncOutcome_synced, st.GetLastSyncOutcome())
	require.Len(t, st.GetCollections(), 3)

	byName := map[string]*datastorev1.CollectionStatus{}
	for _, cs := range st.GetCollections() {
		byName[cs.GetName()] = cs
	}
	require.Contains(t, byName, "schedules")
	assert.Equal(t, datastorev1.CollectionMaterializationState_active, byName["schedules"].GetState())
	assert.Equal(t, int64(1), byName["schedules"].GetRecordCount(), "seed inserted on first materialization")
	assert.NotNil(t, byName["schedules"].GetMaterializedAt())
	assert.Equal(t, int64(0), byName["bookings"].GetRecordCount())
}

func TestApply_SecondApplyIgnoresSeeds(t *testing.T) {
	env := setupTest(t)

	_, err := env.controller.Apply(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	// Re-apply the identical manifest: seed-once means no new inserts,
	// and the drift is reported.
	updated, err := env.controller.Apply(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	for _, cs := range updated.GetStatus().GetCollections() {
		if cs.GetName() == "schedules" {
			assert.Equal(t, int64(1), cs.GetRecordCount(), "seeds must not re-insert")
			assert.Equal(t, int32(1), cs.GetIgnoredSeedCount())
		}
	}
}

func TestUpdate_ChangeMatrixRejections(t *testing.T) {
	env := setupTest(t)
	_, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	t.Run("type change rejected, prior schema retained", func(t *testing.T) {
		mutated := clinicDatastore("clinic")
		mutated.Spec.Collections[0].Fields[0].Type = datastorev1.FieldType_string

		_, err := env.controller.Apply(testContext(), mutated)
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), `cannot change type of field "day_of_week"`)

		// The retained resource carries the prior spec and the
		// fail-loud rejected outcome.
		current, err := env.controller.GetByReference(testContext(), &apiresource.ApiResourceReference{
			Org: identity.SystemOrg, Slug: "clinic",
		})
		require.NoError(t, err)
		assert.Equal(t, datastorev1.FieldType_integer, current.GetSpec().GetCollections()[0].GetFields()[0].GetType())
		assert.Equal(t, datastorev1.DatastoreSyncOutcome_rejected, current.GetStatus().GetLastSyncOutcome())
	})

	t.Run("required without default rejected against non-empty collection", func(t *testing.T) {
		mutated := clinicDatastore("clinic")
		mutated.Spec.Collections[0].Fields = append(mutated.Spec.Collections[0].Fields,
			&datastorev1.FieldDeclaration{Name: "room", Type: datastorev1.FieldType_string, Required: true})

		_, err := env.controller.Apply(testContext(), mutated)
		require.Error(t, err)
		assert.Contains(t, status.Convert(err).Message(), `cannot add required field "room" without a default`)
	})

	t.Run("removing a non-empty collection requires the acknowledgment annotation", func(t *testing.T) {
		mutated := clinicDatastore("clinic")
		mutated.Spec.Collections = mutated.Spec.Collections[1:] // drop seeded schedules
		// The bookings exists constraint targets schedules; removing the
		// collection forces removing the constraint too (validation
		// rejects a dangling reference before the sync ever runs).
		mutated.Spec.Collections[1].Exists = nil

		_, err := env.controller.Apply(testContext(), mutated)
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), schemasync.AckCollectionRemovalAnnotation)

		// Acknowledged: allowed, reported as removed, data retained.
		mutated.Metadata.Annotations = map[string]string{
			schemasync.AckCollectionRemovalAnnotation: "schedules",
		}
		updated, err := env.controller.Apply(testContext(), mutated)
		require.NoError(t, err)
		var removed *datastorev1.CollectionStatus
		for _, cs := range updated.GetStatus().GetCollections() {
			if cs.GetName() == "schedules" {
				removed = cs
			}
		}
		require.NotNil(t, removed, "removed collection must stay in the sync report")
		assert.Equal(t, datastorev1.CollectionMaterializationState_removed, removed.GetState())
	})
}

func TestUpdate_NewConstraintValidatedAgainstExistingRecords(t *testing.T) {
	env := setupTest(t)
	_, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	// The seeded schedule has day_of_week = 2; a new check requiring
	// weekends only is violated by it.
	mutated := clinicDatastore("clinic")
	mutated.Spec.Collections[0].Checks = append(mutated.Spec.Collections[0].Checks,
		&datastorev1.CheckConstraint{
			Name:       "weekends_only",
			Expression: "this.day_of_week == 0 || this.day_of_week == 6",
			Message:    "only weekend sessions allowed",
		})

	_, err = env.controller.Apply(testContext(), mutated)
	require.Error(t, err)
	assert.Contains(t, status.Convert(err).Message(),
		`constraint "weekends_only" is violated by 1 existing records in collection "schedules"`)
}

// --- guarded delete ----------------------------------------------------------

func TestDelete_Guards(t *testing.T) {
	env := setupTest(t)
	created, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	t.Run("non-empty datastore requires force", func(t *testing.T) {
		_, err := env.controller.Delete(testContext(), &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(),
		})
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), "holds 1 record across 1 collection")
	})

	t.Run("agent reference blocks even with force", func(t *testing.T) {
		agent := &agentv1.Agent{
			Metadata: &apiresource.ApiResourceMetadata{
				Id: "agt_test", Name: "clinic-assistant", Slug: "clinic-assistant", Org: identity.SystemOrg,
			},
			Spec: &agentv1.AgentSpec{
				DatastoreUsages: []*agentv1.DatastoreUsage{{
					DatastoreRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_datastore, Slug: "clinic",
					},
				}},
			},
		}
		require.NoError(t, env.store.SaveResource(testContext(), apiresourcekind.ApiResourceKind_agent, agent.GetMetadata().GetId(), agent))

		_, err := env.controller.Delete(testContext(), &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(), Force: true,
		})
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Contains(t, st.Message(), "referenced by 1 agents (clinic-assistant)")

		require.NoError(t, env.store.DeleteResource(testContext(), apiresourcekind.ApiResourceKind_agent, "agt_test"))
	})

	t.Run("force acknowledges and destroys the substrate", func(t *testing.T) {
		deleted, err := env.controller.Delete(testContext(), &apiresource.ApiResourceDeleteInput{
			ResourceId: created.GetMetadata().GetId(), Force: true,
		})
		require.NoError(t, err)
		assert.Equal(t, "clinic", deleted.GetMetadata().GetSlug())

		// Every collection table is gone, including the seeded one.
		require.NoError(t, env.recordStore.WithWriteTx(testContext(), func(tx recordstore.Tx) error {
			tables, err := tx.ListCollectionTables(created.GetMetadata().GetId())
			require.NoError(t, err)
			assert.Empty(t, tables)
			return nil
		}))
	})
}

// --- record RPCs -------------------------------------------------------------

func TestRecordRPCs_EndToEnd(t *testing.T) {
	env := setupTest(t)
	_, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	t.Run("insert stamps the envelope and passes constraints", func(t *testing.T) {
		envelope, err := insertBooking(t, env, "clinic", tuesdaySlot, "Asha")
		require.NoError(t, err)
		assert.Contains(t, envelope.GetId(), "dsr_")
		assert.NotNil(t, envelope.GetCreatedAt())
		assert.Equal(t, identity.LocalPrincipalID, envelope.GetCreatedBy().GetPrincipal().GetId())
		assert.Equal(t, "confirmed", envelope.GetFields().GetFields()["status"].GetStringValue(), "default applied")
	})

	t.Run("unique violation returns the declared message", func(t *testing.T) {
		_, err := insertBooking(t, env, "clinic", tuesdaySlot, "Ravi")
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.AlreadyExists, st.Code())
		assert.Equal(t, "that slot is already booked", st.Message())
		assert.Equal(t, "one_confirmed_per_slot", errorInfoMetadata(t, err)["constraint"])
	})

	t.Run("check violation returns the declared message", func(t *testing.T) {
		_, err := insertBooking(t, env, "clinic", "2026-07-21T05:10:00Z", "Ravi") // 10:40 IST — off grid
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Equal(t, "appointments start on the half hour", st.Message())
	})

	t.Run("exists violation: outside clinic hours", func(t *testing.T) {
		_, err := insertBooking(t, env, "clinic", "2026-07-21T14:00:00Z", "Ravi") // 19:30 IST
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.FailedPrecondition, st.Code())
		assert.Equal(t, "that time is outside clinic hours", st.Message())
	})

	t.Run("system field in payload rejected", func(t *testing.T) {
		record, err := structpb.NewStruct(map[string]any{
			"slot_start": tuesdaySlot, "patient_name": "Asha", "created_by": "someone-else",
		})
		require.NoError(t, err)
		_, err = env.recordController.InsertRecord(testContext(), &datastorev1.InsertRecordRequest{
			Datastore: "clinic", Collection: "bookings", Record: record,
		})
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Convert(err).Code())
	})

	t.Run("find filters, paginates, and orders deterministically", func(t *testing.T) {
		// One more booking at 11:00 IST (05:30Z) to have two.
		_, err := insertBooking(t, env, "clinic", "2026-07-21T05:30:00Z", "Meera")
		require.NoError(t, err)

		list, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "clinic", Collection: "bookings",
			Filter: &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{{
				Field: "status", Op: datastorev1.RecordConditionOp_eq, Value: structpb.NewStringValue("confirmed"),
			}}},
		})
		require.NoError(t, err)
		assert.Equal(t, int32(2), list.GetTotal())
		assert.Equal(t, int32(25), list.GetLimit(), "default limit")
		require.Len(t, list.GetRecords(), 2)

		page, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "clinic", Collection: "bookings", Limit: 1, Offset: 1,
		})
		require.NoError(t, err)
		assert.Equal(t, int32(2), page.GetTotal())
		assert.Len(t, page.GetRecords(), 1)
	})

	t.Run("invalid filter is INVALID_ARGUMENT", func(t *testing.T) {
		_, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "clinic", Collection: "bookings",
			Filter: &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{{
				Field: "status", Op: datastorev1.RecordConditionOp_gt, Value: structpb.NewStringValue("a"),
			}}},
		})
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Convert(err).Code())
	})

	t.Run("update merges partially and re-evaluates constraints", func(t *testing.T) {
		list, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "clinic", Collection: "bookings", Limit: 1,
		})
		require.NoError(t, err)
		id := list.GetRecords()[0].GetId()

		fields, err := structpb.NewStruct(map[string]any{"status": "cancelled"})
		require.NoError(t, err)
		updated, err := env.recordController.UpdateRecord(testContext(), &datastorev1.UpdateRecordRequest{
			Datastore: "clinic", Collection: "bookings", Id: id, Fields: fields,
		})
		require.NoError(t, err)
		assert.Equal(t, "cancelled", updated.GetFields().GetFields()["status"].GetStringValue())
		assert.Equal(t, list.GetRecords()[0].GetFields().GetFields()["patient_name"].GetStringValue(),
			updated.GetFields().GetFields()["patient_name"].GetStringValue(), "unsupplied fields preserved")
	})

	t.Run("delete returns the envelope and removes the record", func(t *testing.T) {
		envelope, err := insertBooking(t, env, "clinic", "2026-07-21T06:00:00Z", "Kiran")
		require.NoError(t, err)

		deleted, err := env.recordController.DeleteRecord(testContext(), &datastorev1.DeleteRecordRequest{
			Datastore: "clinic", Collection: "bookings", Id: envelope.GetId(),
		})
		require.NoError(t, err)
		assert.Equal(t, envelope.GetId(), deleted.GetId())

		_, err = env.recordController.DeleteRecord(testContext(), &datastorev1.DeleteRecordRequest{
			Datastore: "clinic", Collection: "bookings", Id: envelope.GetId(),
		})
		require.Error(t, err)
		assert.Equal(t, codes.NotFound, status.Convert(err).Code())
	})

	t.Run("verb denial uses the fixed relayable text", func(t *testing.T) {
		// The operator role has read-only on schedules.
		record, err := structpb.NewStruct(map[string]any{
			"day_of_week": 3, "session_start": "10:00", "session_end": "13:00",
		})
		require.NoError(t, err)
		_, err = env.recordController.InsertRecord(testContext(), &datastorev1.InsertRecordRequest{
			Datastore: "clinic", Collection: "schedules", Record: record,
		})
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.PermissionDenied, st.Code())
		assert.Equal(t, "you are not allowed to insert records in schedules", st.Message())
	})

	t.Run("unknown datastore and collection are NOT_FOUND", func(t *testing.T) {
		_, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "nonexistent", Collection: "bookings",
		})
		require.Error(t, err)
		assert.Equal(t, codes.NotFound, status.Convert(err).Code())

		_, err = env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "clinic", Collection: "nonexistent",
		})
		require.Error(t, err)
		assert.Equal(t, codes.NotFound, status.Convert(err).Code())
	})
}

func TestRecordRPCs_DenyByDefault(t *testing.T) {
	env := setupTest(t)
	ds := clinicDatastore("locked")
	ds.Spec.Authorization.DefaultRole = "" // unbound callers get nothing
	_, err := env.controller.Create(testContext(), ds)
	require.NoError(t, err)

	t.Run("every verb denied without a role", func(t *testing.T) {
		_, err := env.recordController.FindRecords(testContext(), &datastorev1.FindRecordsRequest{
			Datastore: "locked", Collection: "bookings",
		})
		require.Error(t, err)
		st := status.Convert(err)
		assert.Equal(t, codes.PermissionDenied, st.Code())
		assert.Equal(t, "you are not allowed to read records in bookings", st.Message())
	})

	t.Run("describe still answers, with empty access", func(t *testing.T) {
		desc, err := env.recordController.DescribeDatastore(testContext(), &datastorev1.DescribeDatastoreRequest{
			Datastore: "locked",
		})
		require.NoError(t, err)
		require.Len(t, desc.GetCollections(), 3)
		for _, coll := range desc.GetCollections() {
			assert.Empty(t, coll.GetAccess(), "deny-by-default renders as an empty verb list")
		}
	})
}

func TestDescribeDatastore_ProjectsSchemaAndEffectiveVerbs(t *testing.T) {
	env := setupTest(t)
	_, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	desc, err := env.recordController.DescribeDatastore(testContext(), &datastorev1.DescribeDatastoreRequest{
		Datastore: "clinic",
	})
	require.NoError(t, err)
	assert.Equal(t, "clinic", desc.GetDatastore())
	assert.Equal(t, "Asia/Kolkata", desc.GetTimezone())

	var bookings *datastorev1.CollectionDescription
	for _, coll := range desc.GetCollections() {
		if coll.GetName() == "bookings" {
			bookings = coll
		}
	}
	require.NotNil(t, bookings)
	assert.Len(t, bookings.GetFields(), 3)
	assert.Len(t, bookings.GetAccess(), 4, "operator holds all four verbs on bookings")

	constraintNames := map[string]datastorev1.ConstraintKind{}
	for _, c := range bookings.GetConstraints() {
		constraintNames[c.GetName()] = c.GetKind()
	}
	assert.Equal(t, datastorev1.ConstraintKind_unique, constraintNames["one_confirmed_per_slot"])
	assert.Equal(t, datastorev1.ConstraintKind_check, constraintNames["half_hour_grid"])
	assert.Equal(t, datastorev1.ConstraintKind_exists, constraintNames["inside_clinic_hours"])
	assert.Equal(t, datastorev1.ConstraintKind_not_exists, constraintNames["not_on_closed_date"])
}

// TestOwnScope_DeniesForeignRecords covers the own-scope denial the RPC
// surface cannot produce in OSS (every caller is the same local
// principal): a record attributed to a channel sender is not the local
// operator's, so an own-scoped write must be denied.
func TestOwnScope_DeniesForeignRecords(t *testing.T) {
	env := setupTest(t)
	ds := clinicDatastore("clinic")
	// Narrow the operator's bookings grant to own-scoped update only.
	ds.Spec.Collections[2].Grants = []*datastorev1.DatastoreGrant{{
		Role:  "operator",
		Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_update},
		Scope: datastorev1.DatastoreGrantScope_own,
	}}
	created, err := env.controller.Create(testContext(), ds)
	require.NoError(t, err)

	// Plant a record attributed to a (future) channel sender directly in
	// the substrate — the cloud edition's write shape.
	foreign := &recordstore.Record{
		ID: "dsr_foreign", CreatedAt: created.GetStatus().GetLastSyncedAt().AsTime(),
		UpdatedAt: created.GetStatus().GetLastSyncedAt().AsTime(),
		CreatedBy: &datastorev1.DatastoreSubject{
			Kind: &datastorev1.DatastoreSubject_ChannelSender{
				ChannelSender: &datastorev1.ChannelSenderSubject{SenderKind: "whatsapp_phone", Value: "9198"},
			},
		},
		CreatedByKey: "channel/whatsapp_phone/9198",
		Org:          identity.SystemOrg,
		Fields: map[string]any{
			"slot_start": "2026-07-21T05:00:00.000000000Z", "patient_name": "Asha", "status": "confirmed",
		},
	}
	require.NoError(t, env.recordStore.WithWriteTx(testContext(), func(tx recordstore.Tx) error {
		return tx.Insert(created.GetMetadata().GetId(), "bookings", foreign)
	}))

	fields, err := structpb.NewStruct(map[string]any{"status": "cancelled"})
	require.NoError(t, err)
	_, err = env.recordController.UpdateRecord(testContext(), &datastorev1.UpdateRecordRequest{
		Datastore: "clinic", Collection: "bookings", Id: "dsr_foreign", Fields: fields,
	})
	require.Error(t, err)
	st := status.Convert(err)
	assert.Equal(t, codes.PermissionDenied, st.Code())
	assert.Equal(t, "you may only update records you created in bookings", st.Message())
}

// TestConcurrency_ScheduleCloseVsBookingInsert is the DD-007 required
// concurrency test, domain half: a booking insert whose not_exists
// verdict was formed before a schedule-close commits must NOT commit —
// BEGIN IMMEDIATE serializes the two writers, so the booking's check
// runs after the close is durable and fails with the declared message.
func TestConcurrency_ScheduleCloseVsBookingInsert(t *testing.T) {
	env := setupTest(t)
	created, err := env.controller.Create(testContext(), clinicDatastore("clinic"))
	require.NoError(t, err)

	closeInTx := make(chan struct{})
	closeDone := make(chan error, 1)

	// Writer A: close 2026-07-21, holding the write transaction open
	// long enough for the booking RPC to arrive and block on the lock.
	go func() {
		closeDone <- env.recordStore.WithWriteTx(testContext(), func(tx recordstore.Tx) error {
			exception := &recordstore.Record{
				ID: "dsr_close", CreatedAt: created.GetStatus().GetLastSyncedAt().AsTime(),
				UpdatedAt:    created.GetStatus().GetLastSyncedAt().AsTime(),
				CreatedBy:    identity.LocalSubject(),
				CreatedByKey: identity.SubjectKey(identity.LocalSubject()),
				Org:          identity.SystemOrg,
				Fields:       map[string]any{"exception_date": "2026-07-21"},
			}
			if err := tx.Insert(created.GetMetadata().GetId(), "schedule_exceptions", exception); err != nil {
				return err
			}
			close(closeInTx) // the close is written but not yet committed
			return nil
		})
	}()

	// Writer B: once the close transaction holds the write lock, try to
	// book that day. The insert must wait for the lock, then see the
	// committed exception inside its own transaction, and fail.
	<-closeInTx
	_, err = insertBooking(t, env, "clinic", tuesdaySlot, "Asha")
	require.NoError(t, <-closeDone, "the schedule close must commit")
	require.Error(t, err, "the racing booking must not commit against the stale open-date verdict")
	st := status.Convert(err)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Equal(t, "the clinic is closed at that time", st.Message())

	// And the substrate agrees: no booking exists.
	n, err := env.recordStore.CountRecords(testContext(), created.GetMetadata().GetId(), "bookings")
	require.NoError(t, err)
	assert.Equal(t, int64(0), n)
}

func TestEnforceOrgQuota(t *testing.T) {
	env := setupTest(t)

	// Minimal datastores (no seeds, one tiny collection) up to the cap.
	minimal := func(name string) *datastorev1.Datastore {
		return &datastorev1.Datastore{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Datastore",
			Metadata:   &apiresource.ApiResourceMetadata{Name: name, Org: identity.SystemOrg},
			Spec: &datastorev1.DatastoreSpec{
				Collections: []*datastorev1.CollectionDeclaration{{
					Name:   "items",
					Fields: []*datastorev1.FieldDeclaration{{Name: "label", Type: datastorev1.FieldType_string}},
				}},
			},
		}
	}

	for i := 0; i < 25; i++ {
		_, err := env.controller.Create(testContext(), minimal(("store-")+string(rune('a'+i))))
		require.NoError(t, err, "datastore %d within the quota", i+1)
	}

	_, err := env.controller.Create(testContext(), minimal("one-too-many"))
	require.Error(t, err)
	st := status.Convert(err)
	assert.Equal(t, codes.FailedPrecondition, st.Code())
	assert.Contains(t, st.Message(), "already holds 25 datastores (limit 25)")
}

// errorInfoMetadata extracts the google.rpc.ErrorInfo metadata attached
// to a datastore contract error.
func errorInfoMetadata(t *testing.T, err error) map[string]string {
	t.Helper()
	for _, detail := range status.Convert(err).Details() {
		if info, ok := detail.(interface{ GetMetadata() map[string]string }); ok {
			return info.GetMetadata()
		}
	}
	t.Fatal("error carries no ErrorInfo detail")
	return nil
}
