package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
)

// FindRecords finds records in a collection with a typed filter.
//
// Requires the read verb. Conditions are validated against the declared
// schema (per-type operator matrix) and the caller's column-level read
// access (a field-restricted grant admits conditions and order_by only
// on readable fields), then AND-combined; an own-scoped read grant
// composes into the query as a conjunction the filter grammar can
// neither express, relax, nor observe, and the partition scopes the
// query the same way. Result envelopes carry only readable fields.
// Reading an unmaterialized partition returns an empty page and creates
// nothing (only writes materialize partitions). Results paginate
// (default 25, max 100) with deterministic ordering (created_at desc,
// id tiebreak unless order_by overrides).
func (c *DatastoreRecordController) FindRecords(ctx context.Context, req *datastorev1.FindRecordsRequest) (*datastorev1.RecordList, error) {
	call, err := c.resolveCall(ctx, req.GetOrg(), req.GetDatastore(), req.GetCollection(), req.GetPartition())
	if err != nil {
		return nil, err
	}
	grant, err := call.requireVerb(datastorev1.DatastoreVerb_read)
	if err != nil {
		return nil, err
	}
	proj := call.readProjection()

	conditions, err := records.BuildConditions(call.collection, proj, req.GetFilter())
	if err != nil {
		return nil, err
	}
	orderBy, err := records.BuildOrderBy(call.collection, proj, req.GetOrderBy())
	if err != nil {
		return nil, err
	}

	query := recordstore.FindQuery{
		DatastoreID: call.datastore.GetMetadata().GetId(),
		Collection:  call.collection.GetName(),
		Partition:   call.partition,
		Conditions:  conditions,
		OrderBy:     orderBy,
		Limit:       records.NormalizeLimit(req.GetLimit()),
		Offset:      int(req.GetOffset()),
	}
	if grant.Own {
		query.OwnerKey = call.subjectKey
	}

	recs, total, err := c.recordStore.Find(ctx, query)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to find records")
	}

	list := &datastorev1.RecordList{
		Total:  int32(total),
		Limit:  int32(query.Limit),
		Offset: int32(query.Offset),
	}
	for _, rec := range recs {
		envelope, err := records.Envelope(call.collection, rec, proj)
		if err != nil {
			return nil, grpclib.InternalError(err, "failed to project record")
		}
		list.Records = append(list.Records, envelope)
	}
	return list, nil
}
