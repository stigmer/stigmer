package steps

import (
	"errors"
	"time"

	"github.com/rs/zerolog/log"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schemasync"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// SchemaSyncStep is the synchronous, gating schema-sync step (DD-004
// SD-5), placed after Persist in the create and update pipelines.
//
// It reconciles the record substrate with the declared schema in one
// immediate transaction (change matrix, DDL, unique indexes, partition
// catalog) and writes the sync report to status, re-persisting the
// resource.
//
// Gating semantics on rejection — "the datastore retains its prior
// schema":
//   - create: the just-persisted resource is deleted (there is no prior
//     schema to retain), and the RPC fails FAILED_PRECONDITION;
//   - update: the prior resource is restored verbatim with
//     last_sync_outcome = rejected stamped on it (the observable
//     fail-loud signal), and the RPC fails FAILED_PRECONDITION.
//
// Substrate errors (not matrix rejections) fail loudly too — a
// datastore whose declared uniques are not enforced must not exist —
// with the same restore semantics.
type SchemaSyncStep struct {
	store       store.Store
	recordStore recordstore.Store
}

func NewSchemaSyncStep(store store.Store, recordStore recordstore.Store) *SchemaSyncStep {
	return &SchemaSyncStep{store: store, recordStore: recordStore}
}

func (s *SchemaSyncStep) Name() string {
	return "DatastoreSchemaSync"
}

func (s *SchemaSyncStep) Execute(ctx *pipeline.RequestContext[*datastorev1.Datastore]) error {
	updated := ctx.NewState()

	// Update pipelines load the prior resource; create pipelines don't.
	var existing *datastorev1.Datastore
	if prior, ok := ctx.Get(pipelinesteps.ExistingResourceKey).(*datastorev1.Datastore); ok {
		existing = prior
	}

	status, err := schemasync.Sync(ctx.Context(), s.recordStore, existing, updated)
	if err != nil {
		return s.failAndRestore(ctx, existing, updated, err)
	}

	// Preserve the audit block the persist path wrote; the sync report
	// is the rest of the status.
	status.Audit = updated.GetStatus().GetAudit()
	updated.Status = status

	kind := apiresourcekind.ApiResourceKind_datastore
	if err := s.store.SaveResource(ctx.Context(), kind, updated.GetMetadata().GetId(), updated); err != nil {
		return grpclib.InternalError(err, "failed to persist datastore sync report")
	}
	ctx.SetNewState(updated)
	return nil
}

// failAndRestore undoes the already-persisted spec so the datastore
// retains its prior schema, then surfaces the sync failure.
func (s *SchemaSyncStep) failAndRestore(
	ctx *pipeline.RequestContext[*datastorev1.Datastore],
	existing, updated *datastorev1.Datastore,
	syncErr error,
) error {
	kind := apiresourcekind.ApiResourceKind_datastore
	id := updated.GetMetadata().GetId()

	if existing == nil {
		// Create: nothing to retain — remove the just-persisted resource.
		if err := s.store.DeleteResource(ctx.Context(), kind, id); err != nil {
			log.Error().Err(err).Str("id", id).
				Msg("SchemaSync: failed to remove datastore after rejected create sync")
		}
	} else {
		// Update: restore the prior resource, stamping the rejected
		// outcome (the observable fail-loud signal on the retained
		// schema).
		if existing.Status == nil {
			existing.Status = &datastorev1.DatastoreStatus{}
		}
		existing.Status.LastSyncOutcome = datastorev1.DatastoreSyncOutcome_rejected
		existing.Status.LastSyncedAt = timestamppb.New(time.Now().UTC())
		if err := s.store.SaveResource(ctx.Context(), kind, id, existing); err != nil {
			log.Error().Err(err).Str("id", id).
				Msg("SchemaSync: failed to restore prior datastore after rejected update sync")
		}
	}

	var rejection *schemasync.RejectionError
	if errors.As(syncErr, &rejection) {
		return grpclib.FailedPreconditionError("%s", rejection.Reason)
	}
	return grpclib.InternalError(syncErr, "datastore schema sync failed")
}
