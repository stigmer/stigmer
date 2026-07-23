//go:build integration

// Records reach chain, end to end: a real session-scoped sandbox token
// presented to the record RPCs must resolve the full Path-1 chain —
// token -> session -> agent instance -> agent -> datastore_usages ->
// org — against real Mongo documents, derive the partition from the
// instance and the record-layer subject from the session's
// channel-sender metadata, and then run the grant layer against real
// Postgres. The cloud RecordReachTest proves the chain logic over
// mocks and DatastoreRecordServicePostgresTest proves the grant layer
// with pre-built subjects; these tests join the two over the wire.
//
// Broken-chain links deeper than "session not found" (missing
// instance/agent documents) stay covered by the mocked RecordReachTest:
// the real Create RPCs enforce graph integrity, so those states are not
// honestly reproducible here.
package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// Reach-layer denial texts. These are contract bytes: agents relay them
// verbatim, and the cloud control plane defines them as constants in
// RecordReach.java (stigmer-cloud). Any drift here is a cross-edition
// contract break, not a test nit.
const (
	reachChainDenied      = "record access could not be verified for this session"
	reachNotAttachedFmt   = `this agent does not use datastore "%s"`
	reachBootstrapRefused = "record access requires a session-scoped runner credential; " +
		"exchange the bootstrap credential for a sandbox token first"
	reachVisitorRefused        = "record access is not available for this caller"
	reachPartitionNotCallerSet = "partition is derived from the agent instance for agent sessions and must not be set"
	reachOrgNotCallerSet       = "org is derived from the session for agent sessions and must not be set"
)

// Record-layer (grant) denial texts and the ErrorInfo companions —
// DatastoreException.java in cloud, the dserrors package in OSS,
// byte-identical by contract.
const (
	recordsErrorDomain      = "datastore.stigmer.ai"
	recordsReasonDenied     = "ACCESS_DENIED"
	recordsReasonConstraint = "CONSTRAINT_VIOLATION"
	recordsReasonNotFound   = "NOT_FOUND"
)

// The fixture's channel senders (WhatsApp wa_ids: digits, no "+") and
// the platform principal a senderless session resolves to.
const (
	senderPatientA = "919800000001"
	senderPatientB = "919800000002"
	senderReadonly = "919800000003"
	senderUnbound  = "919800000009"

	principalSubject = "idt-records-reach-principal"
	sessionCreator   = "idt-records-reach-creator"

	bookingsCollection = "bookings"
	uniqueSlotMessage  = "that slot is already booked"
	partitionB         = "clinic-b"
)

// clinicBookingsSpec is the minimal clinic shape: one collection, a
// conditional unique, and two roles — one holding insert, one not — so
// reach, sender-identity binding, own scope, verb denial, and the
// declared constraint are all exercisable without the full clinic's
// cross-collection machinery.
func clinicBookingsSpec() *datastorev1.DatastoreSpec {
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
		Description: "records-reach integration fixture (minimal clinic bookings)",
		Timezone:    "Asia/Kolkata",
		Authorization: &datastorev1.DatastoreAuthorization{
			Roles: []*datastorev1.DatastoreRole{{Name: "patient"}, {Name: "readonly"}},
			Bindings: []*datastorev1.DatastoreRoleBinding{
				channelBinding(senderPatientA, "patient"),
				channelBinding(senderPatientB, "patient"),
				channelBinding(senderReadonly, "readonly"),
				{
					Subject: &datastorev1.DatastoreSubject{
						Kind: &datastorev1.DatastoreSubject_Principal{
							Principal: &iampolicyv1.ApiResourceRef{
								Kind: "identity_account",
								Id:   principalSubject,
							},
						},
					},
					Role: "patient",
				},
			},
			// No default_role, deliberately: unbound subjects must land on
			// deny-by-default, so every allowed call below proves a BINDING
			// resolved — not a blanket default.
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
			Uniques: []*datastorev1.UniqueConstraint{{
				Name:   "one_confirmed_per_slot",
				Fields: []string{"slot_start"},
				Where: &datastorev1.UniqueWhere{
					Field:  "status",
					Equals: structpb.NewStringValue("confirmed"),
				},
				Message: uniqueSlotMessage,
			}},
			Grants: []*datastorev1.DatastoreGrant{
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{
					datastorev1.DatastoreVerb_read, datastorev1.DatastoreVerb_insert}},
				{Role: "patient", Verbs: []datastorev1.DatastoreVerb{
					datastorev1.DatastoreVerb_update, datastorev1.DatastoreVerb_delete},
					Scope: datastorev1.DatastoreGrantScope_own},
				{Role: "readonly", Verbs: []datastorev1.DatastoreVerb{
					datastorev1.DatastoreVerb_read}},
			},
		}},
	}
}

// recordsReachFixture is the real resource graph the chain resolves:
// two datastores (one attached to the agent, one deliberately not), an
// agent whose datastore_usages names the first, and two instances
// binding different data partitions.
type recordsReachFixture struct {
	slug           string
	unattachedSlug string
	instDefault    *agentinstancev1.AgentInstance
	instPartB      *agentinstancev1.AgentInstance
}

func setupRecordsReachFixture(t *testing.T, ctx context.Context, base *harness.Clients) recordsReachFixture {
	t.Helper()

	// Datastores before the agent: t.Cleanup runs LIFO, so the agent is
	// deleted first and the datastore's block-on-agent-reference delete
	// guard passes.
	ds := harness.CreateDatastore(t, ctx, base, "records-reach", clinicBookingsSpec())
	unattached := harness.CreateDatastore(t, ctx, base, "records-reach-unattached",
		&datastorev1.DatastoreSpec{
			Description:   "same-org datastore the agent does NOT use",
			Timezone:      "UTC",
			Authorization: &datastorev1.DatastoreAuthorization{},
			Collections: []*datastorev1.CollectionDeclaration{{
				Name:   "notes",
				Fields: []*datastorev1.FieldDeclaration{{Name: "text", Type: datastorev1.FieldType_string}},
			}},
		})

	agent := harness.CreateAgent(t, ctx, base, "records-reach-agent",
		"You are the records-reach integration fixture agent.",
		harness.WithDatastoreUsage(ds.GetMetadata().GetSlug()))

	createInstance := func(partition string) *agentinstancev1.AgentInstance {
		inst, err := base.AgentInstanceCommand.Create(ctx, &agentinstancev1.AgentInstance{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "AgentInstance",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "records-reach-inst-" + uuid.New().String()[:8],
				Org:  harness.TestOrg,
			},
			Spec: &agentinstancev1.AgentInstanceSpec{
				AgentId:            agent.GetMetadata().GetId(),
				DatastorePartition: partition,
			},
		})
		require.NoError(t, err, "create agent instance (partition %q)", partition)
		return inst
	}

	return recordsReachFixture{
		slug:           ds.GetMetadata().GetSlug(),
		unattachedSlug: unattached.GetMetadata().GetSlug(),
		instDefault:    createInstance(""),
		instPartB:      createInstance(partitionB),
	}
}

// sessionRecordClients creates a session on the given instance (with
// optional broker-shaped channel-sender metadata), mints the sandbox
// token production would inject for it, and returns clients whose every
// call presents that token — the exact credential shape the mcp-server
// bridge uses for agent record tools.
func sessionRecordClients(t *testing.T, ctx context.Context, base *harness.Clients,
	instanceID, tokenSub string, senderMetadata map[string]string) *harness.Clients {
	t.Helper()

	var opts []harness.SessionOption
	if senderMetadata != nil {
		opts = append(opts, harness.WithSessionMetadata(senderMetadata))
	}
	session := harness.CreateTestSession(t, ctx, base, instanceID,
		sessionv1.Harness_HARNESS_NATIVE, opts...)

	token, err := harness.MintSandboxToken(tokenSub, session.GetMetadata().GetId())
	require.NoError(t, err, "mint sandbox token for session %s", session.GetMetadata().GetId())

	return harness.NewClients(harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token))
}

func mustRecordStruct(t *testing.T, fields map[string]any) *structpb.Struct {
	t.Helper()
	s, err := structpb.NewStruct(fields)
	require.NoError(t, err, "build record struct")
	return s
}

func insertBooking(t *testing.T, ctx context.Context, c *harness.Clients,
	slug, slotStart, patientName string) *datastorev1.RecordEnvelope {
	t.Helper()
	env, err := c.DatastoreRecordCommand.InsertRecord(ctx, &datastorev1.InsertRecordRequest{
		Datastore:  slug,
		Collection: bookingsCollection,
		Record: mustRecordStruct(t, map[string]any{
			"slot_start":   slotStart,
			"patient_name": patientName,
			"status":       "confirmed",
		}),
	})
	require.NoError(t, err, "insert booking at %s for %s", slotStart, patientName)
	require.NotEmpty(t, env.GetId(), "inserted record should carry an id")
	return env
}

func findBySlot(t *testing.T, ctx context.Context, c *harness.Clients,
	slug, slotStart string) *datastorev1.RecordList {
	t.Helper()
	list, err := c.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
		Datastore:  slug,
		Collection: bookingsCollection,
		Filter: &datastorev1.RecordFilter{Conditions: []*datastorev1.RecordCondition{{
			Field: "slot_start",
			Op:    datastorev1.RecordConditionOp_eq,
			Value: structpb.NewStringValue(slotStart),
		}}},
	})
	require.NoError(t, err, "find bookings at %s", slotStart)
	return list
}

// requireRecordsDenied asserts the gRPC code and the exact relayable
// denial text — the messages are cross-edition contract bytes.
func requireRecordsDenied(t *testing.T, err error, code codes.Code, contains string) *status.Status {
	t.Helper()
	require.Error(t, err, "expected a denial containing %q", contains)
	st, ok := status.FromError(err)
	require.True(t, ok, "expected a gRPC status error, got %T: %v", err, err)
	require.Equal(t, code, st.Code(),
		"unexpected gRPC code (message: %q)", st.Message())
	require.Contains(t, st.Message(), contains,
		"denial text is a relayable contract string")
	return st
}

// recordsErrorInfo extracts the google.rpc.ErrorInfo companion the
// record layer attaches to domain errors (the mcp-server bridge's
// error mapper consumes reason + constraint from it).
func recordsErrorInfo(t *testing.T, err error) *errdetails.ErrorInfo {
	t.Helper()
	for _, d := range status.Convert(err).Details() {
		if info, ok := d.(*errdetails.ErrorInfo); ok {
			return info
		}
	}
	return nil
}

func requireErrorInfo(t *testing.T, err error, reason string, metadata map[string]string) {
	t.Helper()
	info := recordsErrorInfo(t, err)
	require.NotNil(t, info, "record-layer errors must carry google.rpc.ErrorInfo (got: %v)", err)
	require.Equal(t, recordsErrorDomain, info.GetDomain(), "ErrorInfo domain")
	require.Equal(t, reason, info.GetReason(), "ErrorInfo reason")
	for k, v := range metadata {
		require.Equal(t, v, info.GetMetadata()[k], "ErrorInfo metadata %q", k)
	}
}

// TestDatastoreRecordsReach_SessionBound drives the composed chain over
// the wire: JWT verification and enrichment, RecordReach over the real
// session graph, sender-identity subjects, instance-derived partitions,
// and the grant layer on real Postgres (the datastore Apply above ran
// the gating schema-sync that materialized the collection there).
func TestDatastoreRecordsReach_SessionBound(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	base := harness.NewClients(grpcConn)
	fx := setupRecordsReachFixture(t, ctx, base)

	whatsApp := func(waID string) map[string]string {
		return harness.ChannelSenderMetadata(harness.SenderKindWhatsAppPhone, waID)
	}
	patientA := sessionRecordClients(t, ctx, base, fx.instDefault.GetMetadata().GetId(), sessionCreator, whatsApp(senderPatientA))
	patientB := sessionRecordClients(t, ctx, base, fx.instDefault.GetMetadata().GetId(), sessionCreator, whatsApp(senderPatientB))
	readonly := sessionRecordClients(t, ctx, base, fx.instDefault.GetMetadata().GetId(), sessionCreator, whatsApp(senderReadonly))
	unbound := sessionRecordClients(t, ctx, base, fx.instDefault.GetMetadata().GetId(), sessionCreator, whatsApp(senderUnbound))
	senderless := sessionRecordClients(t, ctx, base, fx.instDefault.GetMetadata().GetId(), principalSubject, nil)
	patientAPartB := sessionRecordClients(t, ctx, base, fx.instPartB.GetMetadata().GetId(), sessionCreator, whatsApp(senderPatientA))

	t.Run("channel sender insert carries attribution and reads back", func(t *testing.T) {
		const slot = "2026-08-03T09:00:00Z"
		env := insertBooking(t, ctx, patientA, fx.slug, slot, "Asha")

		cs := env.GetCreatedBy().GetChannelSender()
		require.NotNil(t, cs, "created_by must be the channel sender, got %v", env.GetCreatedBy())
		require.Equal(t, harness.SenderKindWhatsAppPhone, cs.GetSenderKind(), "created_by sender kind")
		require.Equal(t, senderPatientA, cs.GetValue(), "created_by sender value")

		list := findBySlot(t, ctx, patientA, fx.slug, slot)
		require.Len(t, list.GetRecords(), 1, "the inserted booking should read back")
		require.Equal(t, "Asha",
			list.GetRecords()[0].GetFields().GetFields()["patient_name"].GetStringValue(),
			"declared field round-trips")
	})

	t.Run("own scope guards update and delete across senders", func(t *testing.T) {
		const slot = "2026-08-03T09:30:00Z"
		rec := insertBooking(t, ctx, patientA, fx.slug, slot, "Asha")

		// Another sender with the SAME role cannot touch A's record.
		_, err := patientB.DatastoreRecordCommand.UpdateRecord(ctx, &datastorev1.UpdateRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Id:         rec.GetId(),
			Fields:     mustRecordStruct(t, map[string]any{"patient_name": "Mallory"}),
		})
		requireRecordsDenied(t, err, codes.PermissionDenied,
			"you may only update records you created in "+bookingsCollection)
		requireErrorInfo(t, err, recordsReasonDenied,
			map[string]string{"verb": "update", "collection": bookingsCollection, "scope": "own"})

		_, err = patientB.DatastoreRecordCommand.DeleteRecord(ctx, &datastorev1.DeleteRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Id:         rec.GetId(),
		})
		requireRecordsDenied(t, err, codes.PermissionDenied,
			"you may only delete records you created in "+bookingsCollection)

		// The creator can: partial-merge update preserves untouched fields...
		updated, err := patientA.DatastoreRecordCommand.UpdateRecord(ctx, &datastorev1.UpdateRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Id:         rec.GetId(),
			Fields:     mustRecordStruct(t, map[string]any{"patient_name": "Asha Rao"}),
		})
		require.NoError(t, err, "own-scope update by the creator")
		require.Equal(t, "Asha Rao",
			updated.GetFields().GetFields()["patient_name"].GetStringValue(), "updated field")
		require.Equal(t, "confirmed",
			updated.GetFields().GetFields()["status"].GetStringValue(),
			"partial merge must preserve fields the update did not name")

		// ...and delete its own record.
		_, err = patientA.DatastoreRecordCommand.DeleteRecord(ctx, &datastorev1.DeleteRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Id:         rec.GetId(),
		})
		require.NoError(t, err, "own-scope delete by the creator")
	})

	t.Run("role without the verb is denied, deny-by-default hides why", func(t *testing.T) {
		_, err := readonly.DatastoreRecordCommand.InsertRecord(ctx, &datastorev1.InsertRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Record: mustRecordStruct(t, map[string]any{
				"slot_start": "2026-08-03T10:00:00Z", "patient_name": "Reader", "status": "confirmed",
			}),
		})
		requireRecordsDenied(t, err, codes.PermissionDenied,
			"you are not allowed to insert records in "+bookingsCollection)
		requireErrorInfo(t, err, recordsReasonDenied,
			map[string]string{"verb": "insert", "collection": bookingsCollection})

		// The bound read verb still works for the same sender.
		_, err = readonly.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore: fx.slug, Collection: bookingsCollection,
		})
		require.NoError(t, err, "readonly role holds read")

		// An entirely unbound sender gets the SAME text on read —
		// deny-by-default must not leak whether a binding exists.
		_, err = unbound.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore: fx.slug, Collection: bookingsCollection,
		})
		requireRecordsDenied(t, err, codes.PermissionDenied,
			"you are not allowed to read records in "+bookingsCollection)
	})

	t.Run("senderless session resolves the platform principal", func(t *testing.T) {
		const slot = "2026-08-03T11:00:00Z"
		env := insertBooking(t, ctx, senderless, fx.slug, slot, "Console User")

		principal := env.GetCreatedBy().GetPrincipal()
		require.NotNil(t, principal,
			"a session without channel-sender metadata must attribute to the token principal, got %v",
			env.GetCreatedBy())
		require.Equal(t, principalSubject, principal.GetId(), "created_by principal id")
	})

	t.Run("partition is instance-derived and scopes records and uniques", func(t *testing.T) {
		const slot = "2026-08-03T12:00:00Z"
		insertBooking(t, ctx, patientA, fx.slug, slot, "Default-Partition")

		// The clinic-b instance's session sees none of default's records...
		require.Empty(t, findBySlot(t, ctx, patientAPartB, fx.slug, slot).GetRecords(),
			"partition %s must not see default-partition records", partitionB)

		// ...and the SAME confirmed slot inserts cleanly there: the unique
		// constraint is partition-led, not global.
		insertBooking(t, ctx, patientAPartB, fx.slug, slot, "PartB-Patient")

		require.Len(t, findBySlot(t, ctx, patientAPartB, fx.slug, slot).GetRecords(), 1,
			"partition %s sees exactly its own record", partitionB)
		defaultView := findBySlot(t, ctx, patientA, fx.slug, slot)
		require.Len(t, defaultView.GetRecords(), 1, "default partition sees exactly its own record")
		require.Equal(t, "Default-Partition",
			defaultView.GetRecords()[0].GetFields().GetFields()["patient_name"].GetStringValue(),
			"default partition's record is the one written there")

		// First write materialized the named partition in the catalog.
		desc, err := patientAPartB.DatastoreRecordQuery.DescribeDatastore(ctx,
			&datastorev1.DescribeDatastoreRequest{Datastore: fx.slug})
		require.NoError(t, err, "describe after partition write")
		require.Contains(t, desc.GetPartitions(), "default", "catalog always lists default")
		require.Contains(t, desc.GetPartitions(), partitionB, "first write registers the partition")
	})

	t.Run("duplicate confirmed slot violates the declared unique", func(t *testing.T) {
		const slot = "2026-08-03T13:00:00Z"
		insertBooking(t, ctx, patientA, fx.slug, slot, "First")

		_, err := patientA.DatastoreRecordCommand.InsertRecord(ctx, &datastorev1.InsertRecordRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Record: mustRecordStruct(t, map[string]any{
				"slot_start": slot, "patient_name": "Second", "status": "confirmed",
			}),
		})
		requireRecordsDenied(t, err, codes.AlreadyExists, uniqueSlotMessage)
		requireErrorInfo(t, err, recordsReasonConstraint,
			map[string]string{"constraint": "one_confirmed_per_slot"})
	})

	t.Run("prompt-injected slug dies at the usage edge", func(t *testing.T) {
		_, err := patientA.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  fx.unattachedSlug,
			Collection: "notes",
		})
		requireRecordsDenied(t, err, codes.PermissionDenied,
			`this agent does not use datastore "`+fx.unattachedSlug+`"`)
	})

	t.Run("unknown slug is NOT_FOUND without leaking", func(t *testing.T) {
		// A foreign org's datastore is structurally identical to an absent
		// slug here: the reach lookup is scoped to the session's org, so
		// existence elsewhere cannot surface (cross-org lookup is pinned by
		// the cloud RecordReachTest).
		ghost := "ghost-" + uuid.New().String()[:8]
		_, err := patientA.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  ghost,
			Collection: bookingsCollection,
		})
		requireRecordsDenied(t, err, codes.NotFound, `datastore "`+ghost+`" not found`)
		requireErrorInfo(t, err, recordsReasonNotFound, map[string]string{"datastore": ghost})
	})

	t.Run("caller-set partition and org are rejected", func(t *testing.T) {
		_, err := patientA.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Partition:  "default",
		})
		requireRecordsDenied(t, err, codes.InvalidArgument, reachPartitionNotCallerSet)

		_, err = patientA.DatastoreRecordQuery.FindRecords(ctx, &datastorev1.FindRecordsRequest{
			Datastore:  fx.slug,
			Collection: bookingsCollection,
			Org:        harness.TestOrg,
		})
		requireRecordsDenied(t, err, codes.InvalidArgument, reachOrgNotCallerSet)
	})

	t.Run("describe reports caller-effective verbs per subject", func(t *testing.T) {
		verbsFor := func(c *harness.Clients) map[datastorev1.DatastoreVerb]bool {
			desc, err := c.DatastoreRecordQuery.DescribeDatastore(ctx,
				&datastorev1.DescribeDatastoreRequest{Datastore: fx.slug})
			require.NoError(t, err, "describe requires reach only, never a verb")
			for _, coll := range desc.GetCollections() {
				if coll.GetName() != bookingsCollection {
					continue
				}
				verbs := make(map[datastorev1.DatastoreVerb]bool, len(coll.GetAccess()))
				for _, grant := range coll.GetAccess() {
					verbs[grant.GetVerb()] = true
				}
				return verbs
			}
			t.Fatalf("describe response missing the %s collection", bookingsCollection)
			return nil
		}

		require.Len(t, verbsFor(patientA), 4, "patient holds all four verbs (update/delete own-scoped)")
		require.Equal(t, map[datastorev1.DatastoreVerb]bool{datastorev1.DatastoreVerb_read: true},
			verbsFor(readonly), "readonly holds exactly read")
		require.Empty(t, verbsFor(unbound),
			"an unbound sender sees the schema with EMPTY access — describe is reach-gated only")
	})
}

// TestDatastoreRecordsReach_BogusSession_ChainDenied proves the
// session-bound Path-1 reach chain runs for a real signed sandbox token:
// a token whose session_id resolves to no session must die at the chain
// with the fixed relayable denial — NOT fall through to the
// direct-principal path (which would instead demand an org).
//
// This is also the suite's sentinel that test-mode security honors a
// Stigmer-signed sandbox bearer (IntegrationTestSecurityConfig verifies
// the JWT and enriches token_type + session_id into the caller identity).
func TestDatastoreRecordsReach_BogusSession_ChainDenied(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	token, err := harness.MintSandboxToken("idt-records-reach-spike", "ses_does_not_exist")
	require.NoError(t, err, "mint sandbox token")

	conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
	records := datastorev1.NewDatastoreRecordQueryControllerClient(conn)

	_, err = records.DescribeDatastore(ctx, &datastorev1.DescribeDatastoreRequest{
		Datastore: "no-such-datastore",
	})
	requireRecordsDenied(t, err, codes.PermissionDenied, reachChainDenied)
}

// TestDatastoreRecordsReach_RefusedCredentialClasses pins the reach
// dispatch table's refusals: the unscoped bootstrap credential must be
// exchanged before record access, and direct visitor tokens (guest,
// channel) never reach records at all — the dispatch fires on
// token_type alone, before any slug resolution.
func TestDatastoreRecordsReach_RefusedCredentialClasses(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cases := []struct {
		tokenType string
		denial    string
	}{
		{"embedded_runner", reachBootstrapRefused},
		{"guest", reachVisitorRefused},
		{"channel", reachVisitorRefused},
	}
	for _, tc := range cases {
		t.Run(tc.tokenType, func(t *testing.T) {
			token, err := harness.MintTokenOfType("idt-records-reach-refused", tc.tokenType)
			require.NoError(t, err, "mint %s token", tc.tokenType)

			conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)
			records := datastorev1.NewDatastoreRecordQueryControllerClient(conn)

			_, err = records.DescribeDatastore(ctx, &datastorev1.DescribeDatastoreRequest{
				Datastore: "irrelevant-dispatch-precedes-lookup",
			})
			requireRecordsDenied(t, err, codes.PermissionDenied, tc.denial)
		})
	}
}
