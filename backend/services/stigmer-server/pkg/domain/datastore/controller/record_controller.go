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
// exist — no channel broker, no runner sandbox tokens) and the subject
// is the fixed local principal (identity.LocalSubject). The org a slug
// resolves against is the seedpack system org (identity.SystemOrg),
// because the record requests carry no org field — "org resolves from
// the caller's credential", and the OSS credential is the local
// operator of that org.
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
// addressed collection, and the caller subject — everything the
// verb-specific handlers need after the spine has run.
type recordCall struct {
	datastore  *datastorev1.Datastore
	collection *datastorev1.CollectionDeclaration
	subject    *datastorev1.DatastoreSubject
	subjectKey string
	role       string
	hasRole    bool
}

// resolveCall runs the spine up to (but not including) the verb check:
// datastore resolution, reach, and subject/role resolution. Handlers
// that need a verb call requireVerb next; describeDatastore stops here
// (reach only).
func (c *DatastoreRecordController) resolveCall(ctx context.Context, datastoreSlug, collection string) (*recordCall, error) {
	ds, err := c.resolveDatastore(ctx, datastoreSlug)
	if err != nil {
		return nil, err
	}

	// Layer 1 reach — the local-trust pass. The org match ("records
	// stay home") is structural here: resolution above already pinned
	// the datastore to the caller's org.

	subject := identity.LocalSubject()
	role, hasRole := authz.ResolveRole(ds.GetSpec().GetAuthorization(), subject)

	call := &recordCall{
		datastore:  ds,
		subject:    subject,
		subjectKey: identity.SubjectKey(subject),
		role:       role,
		hasRole:    hasRole,
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

// resolveDatastore resolves an org-scoped slug to the datastore
// resource. Slugs are per-org unique, so the (slug, org) pair is the
// full key; the scan mirrors the platform's list-then-filter idiom
// (there is no org-scoped store query).
func (c *DatastoreRecordController) resolveDatastore(ctx context.Context, slug string) (*datastorev1.Datastore, error) {
	resources, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_datastore)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to resolve datastore")
	}
	for _, data := range resources {
		ds := &datastorev1.Datastore{}
		if err := proto.Unmarshal(data, ds); err != nil {
			continue
		}
		if ds.GetMetadata().GetSlug() == slug && ds.GetMetadata().GetOrg() == identity.SystemOrg {
			return ds, nil
		}
	}
	return nil, dserrors.DatastoreNotFound(slug)
}

// loadOwnGuarded loads a record by id inside the write transaction and
// enforces the own scope for id-addressed writes. A record that exists
// but belongs to another caller is denied (OwnScopeDenied) rather than
// hidden — the caller proved knowledge of the id, and the actionable
// error is the contract for update/delete (DD-002 SD-4).
func loadOwnGuarded(tx recordstore.Tx, call *recordCall, id string, grant authz.Grant, verb datastorev1.DatastoreVerb) (*recordstore.Record, error) {
	rec, err := tx.Get(call.datastore.GetMetadata().GetId(), call.collection.GetName(), id)
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
