package controller

import (
	"context"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
)

// UpdateRecord updates a record by id with a partial merge.
//
// Requires the update verb (own scope limits it to records the caller
// created). Only supplied fields change; an explicit null clears a
// field; required fields cannot be cleared. Constraints evaluate on the
// merged result inside the write transaction, so the load, the merge,
// the verdict, and the write are one atomic unit.
func (c *DatastoreRecordController) UpdateRecord(ctx context.Context, req *datastorev1.UpdateRecordRequest) (*datastorev1.RecordEnvelope, error) {
	call, err := c.resolveCall(ctx, req.GetDatastore(), req.GetCollection(), req.GetPartition())
	if err != nil {
		return nil, err
	}
	grant, err := call.requireVerb(datastorev1.DatastoreVerb_update)
	if err != nil {
		return nil, err
	}

	var updated *recordstore.Record
	err = c.recordStore.WithWriteTx(ctx, func(tx recordstore.Tx) error {
		rec, err := loadOwnGuarded(tx, call, req.GetId(), grant, datastorev1.DatastoreVerb_update)
		if err != nil {
			return err
		}

		merged, err := records.MergeUpdateFields(call.collection, rec.Fields, req.GetFields().AsMap())
		if err != nil {
			return err
		}
		if err := records.EvaluateConstraints(tx, call.datastore, call.collection, call.partition, merged); err != nil {
			return err
		}

		rec.Fields = merged
		rec.UpdatedAt = time.Now().UTC()
		if err := tx.Update(call.datastore.GetMetadata().GetId(), call.collection.GetName(), rec); err != nil {
			return records.MapUniqueViolation(err, call.collection)
		}
		updated = rec
		return nil
	})
	if err != nil {
		return nil, err
	}

	return records.Envelope(call.collection, updated)
}
