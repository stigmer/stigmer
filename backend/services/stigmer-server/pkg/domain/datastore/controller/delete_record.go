package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
)

// DeleteRecord deletes a record by id and returns its envelope.
//
// Requires the delete verb (own scope limits it to records the caller
// created). Deletes single records only — record tools never delete
// structures; dropping collections or datastores is the resource
// layer's guarded delete.
func (c *DatastoreRecordController) DeleteRecord(ctx context.Context, req *datastorev1.DeleteRecordRequest) (*datastorev1.RecordEnvelope, error) {
	call, err := c.resolveCall(ctx, req.GetOrg(), req.GetDatastore(), req.GetCollection(), req.GetPartition())
	if err != nil {
		return nil, err
	}
	grant, err := call.requireVerb(datastorev1.DatastoreVerb_delete)
	if err != nil {
		return nil, err
	}

	var deleted *recordstore.Record
	err = c.recordStore.WithWriteTx(ctx, func(tx recordstore.Tx) error {
		rec, err := loadOwnGuarded(tx, call, req.GetId(), grant, datastorev1.DatastoreVerb_delete)
		if err != nil {
			return err
		}
		if err := tx.Delete(call.datastore.GetMetadata().GetId(), call.collection.GetName(), rec.ID); err != nil {
			return grpclib.InternalError(err, "failed to delete record")
		}
		deleted = rec
		return nil
	})
	if err != nil {
		return nil, err
	}

	return records.Envelope(call.collection, deleted, call.readProjection())
}
