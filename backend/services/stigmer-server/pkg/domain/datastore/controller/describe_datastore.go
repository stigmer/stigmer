package controller

import (
	"context"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/authz"
)

// DescribeDatastore describes a datastore's collections, fields,
// constraints, and the calling subject's effective verbs per collection.
//
// Requires reach only (no per-collection verb): a caller with no grants
// sees the schema with empty access lists — deny-by-default renders as
// an empty verb list, never an error. Operator state (bindings, seed
// records, sync report) is deliberately excluded: a caller learns the
// shape of the data and what it may do, never who else has access.
func (c *DatastoreRecordController) DescribeDatastore(ctx context.Context, req *datastorev1.DescribeDatastoreRequest) (*datastorev1.DatastoreDescription, error) {
	call, err := c.resolveCall(ctx, req.GetDatastore(), "")
	if err != nil {
		return nil, err
	}

	spec := call.datastore.GetSpec()
	description := &datastorev1.DatastoreDescription{
		Datastore:   call.datastore.GetMetadata().GetSlug(),
		Description: spec.GetDescription(),
		Timezone:    spec.GetTimezone(),
	}

	for _, coll := range spec.GetCollections() {
		description.Collections = append(description.Collections, &datastorev1.CollectionDescription{
			Name:        coll.GetName(),
			Description: coll.GetDescription(),
			Fields:      coll.GetFields(),
			Constraints: describeConstraints(coll),
			Access:      authz.EffectiveVerbs(coll, call.role, call.hasRole),
		})
	}

	return description, nil
}

// describeConstraints projects the collection's constraints as
// name/kind/message triples — the declared message is the caller-facing
// contract for violations; expressions and where-conditions are
// deliberately excluded.
func describeConstraints(coll *datastorev1.CollectionDeclaration) []*datastorev1.ConstraintDescription {
	var out []*datastorev1.ConstraintDescription
	for _, u := range coll.GetUniques() {
		out = append(out, &datastorev1.ConstraintDescription{
			Name: u.GetName(), Kind: datastorev1.ConstraintKind_unique, Message: u.GetMessage(),
		})
	}
	for _, chk := range coll.GetChecks() {
		out = append(out, &datastorev1.ConstraintDescription{
			Name: chk.GetName(), Kind: datastorev1.ConstraintKind_check, Message: chk.GetMessage(),
		})
	}
	for _, ex := range coll.GetExists() {
		out = append(out, &datastorev1.ConstraintDescription{
			Name: ex.GetName(), Kind: datastorev1.ConstraintKind_exists, Message: ex.GetMessage(),
		})
	}
	for _, ex := range coll.GetNotExists() {
		out = append(out, &datastorev1.ConstraintDescription{
			Name: ex.GetName(), Kind: datastorev1.ConstraintKind_not_exists, Message: ex.GetMessage(),
		})
	}
	return out
}
