// Package controller implements the Datastore resource controllers
// (apply/create/update/delete/updateVisibility/get/getByReference/list)
// and the record controllers (findRecords/describeDatastore/
// insertRecord/updateRecord/deleteRecord) for the OSS control plane.
//
// Layering (see the sibling packages):
//
//	controller   — gRPC handlers as pipelines; grant enforcement
//	schemasync   — sync-on-apply gating engine (change matrix, DDL, seeds)
//	records      — write/read mechanics (payloads, merge, constraints)
//	authz        — Layer-2 grant resolution (subject → role → verb+scope)
//	celeval      — scope-fenced CEL constraint engine
//	recordstore  — SQLite record substrate (own handle, BEGIN IMMEDIATE)
//	schema       — canonical field encodings
//	validation   — cross-field spec validation
//	identity     — the OSS caller subject (fixed local principal)
//	dserrors     — the record-RPC error contract (codes + ErrorInfo)
package controller

import (
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
)

// DatastoreController implements DatastoreCommandController and
// DatastoreQueryController — the resource layer (spec + status), not
// records.
type DatastoreController struct {
	datastorev1.UnimplementedDatastoreCommandControllerServer
	datastorev1.UnimplementedDatastoreQueryControllerServer
	store       store.Store
	recordStore recordstore.Store
}

// NewDatastoreController creates a new DatastoreController.
func NewDatastoreController(store store.Store, recordStore recordstore.Store) *DatastoreController {
	return &DatastoreController{
		store:       store,
		recordStore: recordStore,
	}
}
