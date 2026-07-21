package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
)

// InsertRecord inserts a record into a collection.
//
// Requires the insert verb. System field names in the payload are
// rejected; defaults apply; id (dsr_<ulid>), created_at/updated_at, and
// created_by are server-stamped. Check and exists constraints evaluate
// inside the write transaction; declared uniques are the duplicate
// guard (a retried insert violating one returns ALREADY_EXISTS with the
// declared message, never a duplicate).
func (c *DatastoreRecordController) InsertRecord(ctx context.Context, req *datastorev1.InsertRecordRequest) (*datastorev1.RecordEnvelope, error) {
	call, err := c.resolveCall(ctx, req.GetDatastore(), req.GetCollection())
	if err != nil {
		return nil, err
	}
	if _, err := call.requireVerb(datastorev1.DatastoreVerb_insert); err != nil {
		return nil, err
	}

	fields, err := records.BuildInsertFields(call.collection, req.GetRecord().AsMap())
	if err != nil {
		return nil, err
	}

	rec := records.NewRecord(call.subject, call.datastore.GetMetadata().GetOrg(), fields)

	err = c.recordStore.WithWriteTx(ctx, func(tx recordstore.Tx) error {
		if err := records.EvaluateConstraints(tx, call.datastore, call.collection, fields); err != nil {
			return err
		}
		if err := tx.Insert(call.datastore.GetMetadata().GetId(), call.collection.GetName(), rec); err != nil {
			return records.MapUniqueViolation(err, call.collection)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}

	return records.Envelope(call.collection, rec)
}
