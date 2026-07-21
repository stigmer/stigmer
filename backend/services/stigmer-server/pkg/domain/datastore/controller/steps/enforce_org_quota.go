package steps

import (
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/validation"
	"google.golang.org/protobuf/proto"
)

// EnforceOrgQuotaStep enforces the max-datastores-per-org limit
// (validation.MaxDatastoresPerOrg) in the create pipeline — the one
// structural quota the proto cannot carry (T02 ruling R1). Both
// editions enforce it with the same message.
type EnforceOrgQuotaStep struct {
	store store.Store
}

func NewEnforceOrgQuotaStep(store store.Store) *EnforceOrgQuotaStep {
	return &EnforceOrgQuotaStep{store: store}
}

func (s *EnforceOrgQuotaStep) Name() string {
	return "EnforceDatastoreOrgQuota"
}

func (s *EnforceOrgQuotaStep) Execute(ctx *pipeline.RequestContext[*datastorev1.Datastore]) error {
	org := ctx.NewState().GetMetadata().GetOrg()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_datastore)
	if err != nil {
		return grpclib.InternalError(err, "failed to list datastores for quota check")
	}

	count := 0
	for _, data := range resources {
		existing := &datastorev1.Datastore{}
		if err := proto.Unmarshal(data, existing); err != nil {
			continue
		}
		if existing.GetMetadata().GetOrg() == org {
			count++
		}
	}

	if count >= validation.MaxDatastoresPerOrg {
		return grpclib.FailedPreconditionError(
			"organization %q already holds %d datastores (limit %d)",
			org, count, validation.MaxDatastoresPerOrg)
	}
	return nil
}
