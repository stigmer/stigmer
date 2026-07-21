// Package steps contains the datastore-specific pipeline steps composed
// by the resource controllers alongside the generic steps library.
package steps

import (
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/validation"
)

// ValidateSpecStep runs the cross-field domain validations the proto
// cannot express (name uniqueness, role-reference integrity, default
// type compatibility, timezone validity, constraint reference
// resolution, CEL compilation). Proto field constraints already ran in
// the protovalidate interceptor.
type ValidateSpecStep struct{}

func NewValidateSpecStep() *ValidateSpecStep {
	return &ValidateSpecStep{}
}

func (s *ValidateSpecStep) Name() string {
	return "ValidateDatastoreSpec"
}

func (s *ValidateSpecStep) Execute(ctx *pipeline.RequestContext[*datastorev1.Datastore]) error {
	if err := validation.ValidateSpec(ctx.NewState().GetSpec()); err != nil {
		return grpclib.InvalidArgumentError("%s", err.Error())
	}
	return nil
}
