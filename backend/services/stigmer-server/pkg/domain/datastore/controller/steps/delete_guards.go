package steps

import (
	"fmt"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	pipelinesteps "github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"google.golang.org/protobuf/proto"
)

// loadDatastoreForDelete reads the datastore the delete pipeline's
// LoadExistingForDelete step placed in context.
func loadDatastoreForDelete(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) (*datastorev1.Datastore, error) {
	ds, ok := ctx.Get(pipelinesteps.ExistingResourceKey).(*datastorev1.Datastore)
	if !ok || ds == nil {
		return nil, grpclib.InternalError(nil, "datastore not found in delete context")
	}
	return ds, nil
}

// GuardAgentReferencesStep blocks deletion while any agent's
// datastore_usages references this datastore (DD-003 6b). The block is
// never forceable: an agent would be left with a dangling usage edge —
// a deliberate divergence from the platform's orphan-silently
// precedent, because the dangling reference here is authorization-
// bearing. The error names the referencing agents so the operator can
// detach them.
type GuardAgentReferencesStep struct {
	store store.Store
}

func NewGuardAgentReferencesStep(store store.Store) *GuardAgentReferencesStep {
	return &GuardAgentReferencesStep{store: store}
}

func (s *GuardAgentReferencesStep) Name() string {
	return "GuardDatastoreAgentReferences"
}

func (s *GuardAgentReferencesStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) error {
	ds, err := loadDatastoreForDelete(ctx)
	if err != nil {
		return err
	}
	org := ds.GetMetadata().GetOrg()
	slug := ds.GetMetadata().GetSlug()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_agent)
	if err != nil {
		return grpclib.InternalError(err, "failed to list agents for datastore reference check")
	}

	var referencing []string
	for _, data := range resources {
		agent := &agentv1.Agent{}
		if err := proto.Unmarshal(data, agent); err != nil {
			continue
		}
		if agent.GetMetadata().GetOrg() != org {
			continue
		}
		for _, usage := range agent.GetSpec().GetDatastoreUsages() {
			ref := usage.GetDatastoreRef()
			// An empty ref org is a relative reference resolving to the
			// agent's own org (already filtered to the datastore's org
			// above); an explicit org must match to address this
			// datastore.
			if ref.GetSlug() != slug {
				continue
			}
			if ref.GetOrg() != "" && ref.GetOrg() != org {
				continue
			}
			referencing = append(referencing, agent.GetMetadata().GetSlug())
			break
		}
	}

	if len(referencing) > 0 {
		return grpclib.FailedPreconditionError(
			"datastore %q is referenced by %d agents (%s); remove the datastore_usages references before deleting",
			slug, len(referencing), strings.Join(referencing, ", "))
	}
	return nil
}

// GuardNonEmptyStep requires the force acknowledgment to delete a
// datastore holding records (DD-003 6a): without force the request
// fails FAILED_PRECONDITION reporting how many records across how many
// collections would be destroyed. The counts come from the substrate
// (including collections removed from the spec whose data is retained),
// so the guard can never under-report.
type GuardNonEmptyStep struct {
	recordStore recordstore.Store
}

func NewGuardNonEmptyStep(recordStore recordstore.Store) *GuardNonEmptyStep {
	return &GuardNonEmptyStep{recordStore: recordStore}
}

func (s *GuardNonEmptyStep) Name() string {
	return "GuardDatastoreNonEmpty"
}

func (s *GuardNonEmptyStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) error {
	if ctx.Input().GetForce() {
		return nil
	}
	ds, err := loadDatastoreForDelete(ctx)
	if err != nil {
		return err
	}

	var totalRecords int64
	var nonEmptyCollections int
	err = s.recordStore.WithWriteTx(ctx.Context(), func(tx recordstore.Tx) error {
		collections, err := tx.ListCollectionTables(ds.GetMetadata().GetId())
		if err != nil {
			return err
		}
		for _, coll := range collections {
			count, err := tx.CountRecords(ds.GetMetadata().GetId(), coll)
			if err != nil {
				return err
			}
			if count > 0 {
				nonEmptyCollections++
				totalRecords += count
			}
		}
		return nil
	})
	if err != nil {
		return grpclib.InternalError(err, "failed to count datastore records for delete guard")
	}

	if totalRecords > 0 {
		return grpclib.FailedPreconditionError(
			"datastore %q holds %s across %s; deleting destroys them — pass force to acknowledge",
			ds.GetMetadata().GetSlug(), plural(totalRecords, "record"), plural(int64(nonEmptyCollections), "collection"))
	}
	return nil
}

func plural(n int64, noun string) string {
	if n == 1 {
		return fmt.Sprintf("1 %s", noun)
	}
	return fmt.Sprintf("%d %ss", n, noun)
}

// DropCollectionTablesStep destroys the datastore's record substrate —
// every collection table, including retained tables of removed
// collections. It runs after both guards have passed and before the
// resource row is deleted; this RPC is the only path that destroys
// collections (record tools never delete structures).
type DropCollectionTablesStep struct {
	recordStore recordstore.Store
}

func NewDropCollectionTablesStep(recordStore recordstore.Store) *DropCollectionTablesStep {
	return &DropCollectionTablesStep{recordStore: recordStore}
}

func (s *DropCollectionTablesStep) Name() string {
	return "DropDatastoreCollectionTables"
}

func (s *DropCollectionTablesStep) Execute(ctx *pipeline.RequestContext[*apiresource.ApiResourceDeleteInput]) error {
	ds, err := loadDatastoreForDelete(ctx)
	if err != nil {
		return err
	}

	err = s.recordStore.WithWriteTx(ctx.Context(), func(tx recordstore.Tx) error {
		collections, err := tx.ListCollectionTables(ds.GetMetadata().GetId())
		if err != nil {
			return err
		}
		for _, coll := range collections {
			if err := tx.DropCollectionTable(ds.GetMetadata().GetId(), coll); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return grpclib.InternalError(err, "failed to drop datastore record tables")
	}
	return nil
}
