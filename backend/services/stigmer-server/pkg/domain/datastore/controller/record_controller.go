package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/authz"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/dserrors"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"google.golang.org/protobuf/proto"
)

// DatastoreRecordController implements DatastoreRecordCommandController
// and DatastoreRecordQueryController — the record layer.
//
// Every handler runs the same fail-closed spine (the two-layer model of
// DD-002, in-handler because the RPCs are slug-addressed and carry
// is_skip_authorization):
//
//	resolve datastore (slug, org)  →  Layer 1 reach  →  resolve subject
//	→  Layer 2 (binding → role → per-collection grant, verb + own)
//	→  operate (writes evaluate constraints inside the write transaction)
//
// In OSS, Layer 1 reach is the local-trust pass (no credential classes
// exist — no channel broker, no runner sandbox tokens; GetRunnerScopedToken
// returns empty by design) and the subject is the fixed local principal
// (identity.LocalSubject). The org a slug resolves against is the
// seedpack system org (identity.SystemOrg): an empty request org means
// "the caller's context", which in OSS is the local operator of that
// org, and an explicit request org must match it — anything else is
// NOT_FOUND (records stay home).
//
// The cloud edition's RecordReach dispatches the same five handlers by
// credential class (T05): session-bound sandbox tokens take the DD-006
// Path-1 chain (session → agent → usage edge → org match) with the
// sender-identity subject and the instance-derived partition. That
// chain is deliberately NOT mirrored here — it is unimplementable
// without session-scoped tokens, and dead structure would misdocument
// what OSS enforces (T05 R2: a recorded limitation, the DD-002 SD-6
// honest-layering posture). When OSS grows session-scoped tokens, this
// spine is the swap point and the cloud RecordReach is the reference,
// including its relayable denial texts (cross-edition contract bytes).
//
// These handlers are deliberately NOT pipelines: the pipeline framework
// models resource lifecycle (slug resolution, duplicate checks,
// persist); record operations share none of those steps, and forcing
// them through RequestContext metadata would obscure the one thing that
// matters here — the authorization spine, which must read as a single
// auditable sequence.
type DatastoreRecordController struct {
	datastorev1.UnimplementedDatastoreRecordCommandControllerServer
	datastorev1.UnimplementedDatastoreRecordQueryControllerServer
	store       store.Store
	recordStore recordstore.Store
}

// NewDatastoreRecordController creates a new DatastoreRecordController.
func NewDatastoreRecordController(store store.Store, recordStore recordstore.Store) *DatastoreRecordController {
	return &DatastoreRecordController{
		store:       store,
		recordStore: recordStore,
	}
}

// recordCall is a resolved record-RPC invocation: the datastore, the
// addressed collection, the caller subject, and the data partition —
// everything the verb-specific handlers need after the spine has run.
type recordCall struct {
	datastore  *datastorev1.Datastore
	collection *datastorev1.CollectionDeclaration
	subject    *datastorev1.DatastoreSubject
	subjectKey string
	role       string
	hasRole    bool
	// partition is the resolved data partition every operation of this
	// call is scoped to (DD-010) — never taken from record payloads or
	// filters.
	partition string
}

// resolveCall runs the spine up to (but not including) the verb check:
// datastore resolution, reach, subject/role resolution, and partition
// resolution. Handlers that need a verb call requireVerb next;
// describeDatastore stops here (reach only).
func (c *DatastoreRecordController) resolveCall(ctx context.Context, org, datastoreSlug, collection, partition string) (*recordCall, error) {
	ds, err := c.resolveDatastore(ctx, org, datastoreSlug)
	if err != nil {
		return nil, err
	}

	// Layer 1 reach — the local-trust pass. The org match ("records
	// stay home") is structural here: resolution above already pinned
	// the datastore to the caller's org.

	subject := identity.LocalSubject()
	role, hasRole := authz.ResolveRole(ds.GetSpec().GetAuthorization(), subject)

	// Partition dispatch (DD-010 SD-2): OSS callers are all direct
	// principals (no channel broker, no sandbox tokens), so the request
	// field is honored, empty meaning the shared default. OSS agent
	// sessions therefore land in the default partition — the recorded
	// limitation of T05 R2 (DD-010 amendment). In cloud, session-bound
	// callers get their partition derived from the session's agent
	// instance and a non-empty request partition is rejected
	// (INVALID_ARGUMENT) — never silently overridden.
	call := &recordCall{
		datastore:  ds,
		subject:    subject,
		subjectKey: identity.SubjectKey(subject),
		role:       role,
		hasRole:    hasRole,
		partition:  records.NormalizePartition(partition),
	}

	if collection != "" {
		coll := schema.CollectionByName(ds.GetSpec(), collection)
		if coll == nil {
			return nil, dserrors.CollectionNotFound(datastoreSlug, collection)
		}
		call.collection = coll
	}

	return call, nil
}

// requireVerb enforces the Layer-2 grant for a verb on the call's
// collection: no role or no grant denies with the fixed relayable text
// (which case occurred must not leak).
func (call *recordCall) requireVerb(verb datastorev1.DatastoreVerb) (authz.Grant, error) {
	if call.hasRole {
		if grant, ok := authz.CheckVerb(call.collection, call.role, verb); ok {
			return grant, nil
		}
	}
	return authz.Grant{}, dserrors.VerbDenied(verb.String(), call.collection.GetName())
}

// readProjection resolves the caller's column-level read access to the
// call's collection — the projection every record RPC response passes
// through (find results and write echoes alike): a caller never
// receives a field its read grant does not allow. Write handlers call
// it too; a writer with no read grant gets envelopes with id and
// timestamps only.
func (call *recordCall) readProjection() authz.ReadProjection {
	return authz.ResolveReadProjection(call.collection, call.role, call.hasRole)
}

// resolveDatastore resolves an org-scoped slug to the datastore
// resource. Slugs are per-org unique, so the (slug, org) pair is the
// full key; the scan mirrors the platform's list-then-filter idiom
// (there is no org-scoped store query).
//
// An empty request org resolves to the caller's context — in OSS the
// seedpack system org. An explicit org that names any other org is
// NOT_FOUND, not PERMISSION_DENIED: records stay home (DD-006 inv. 3),
// and whether the foreign datastore exists must not leak.
func (c *DatastoreRecordController) resolveDatastore(ctx context.Context, org, slug string) (*datastorev1.Datastore, error) {
	if org == "" {
		org = identity.SystemOrg
	}
	if org != identity.SystemOrg {
		return nil, dserrors.DatastoreNotFound(slug)
	}
	resources, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_datastore)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to resolve datastore")
	}
	for _, data := range resources {
		ds := &datastorev1.Datastore{}
		if err := proto.Unmarshal(data, ds); err != nil {
			continue
		}
		if ds.GetMetadata().GetSlug() == slug && ds.GetMetadata().GetOrg() == org {
			return ds, nil
		}
	}
	return nil, dserrors.DatastoreNotFound(slug)
}

// loadOwnGuarded loads a record by id inside the write transaction —
// scoped to the call's partition, so a record living in another
// partition is NOT_FOUND by construction — and enforces the own scope
// for id-addressed writes. A record that exists but belongs to another
// caller is denied (OwnScopeDenied) rather than hidden — the caller
// proved knowledge of the id, and the actionable error is the contract
// for update/delete (DD-002 SD-4).
func loadOwnGuarded(tx recordstore.Tx, call *recordCall, id string, grant authz.Grant, verb datastorev1.DatastoreVerb) (*recordstore.Record, error) {
	rec, err := tx.Get(call.datastore.GetMetadata().GetId(), call.collection.GetName(), call.partition, id)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to load record")
	}
	if rec == nil {
		return nil, dserrors.RecordNotFound(call.collection.GetName(), id)
	}
	if grant.Own && rec.CreatedByKey != call.subjectKey {
		return nil, dserrors.OwnScopeDenied(verb.String(), call.collection.GetName())
	}
	return rec, nil
}
