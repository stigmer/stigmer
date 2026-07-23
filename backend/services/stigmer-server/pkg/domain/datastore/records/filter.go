package records

import (
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/authz"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/dserrors"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"google.golang.org/protobuf/types/known/structpb"
)

// Pagination bounds (DD-005 SD-2). The proto caps limit at 100; the
// default applies when the caller leaves it unset.
const (
	DefaultFindLimit = 25
	MaxFindLimit     = 100
)

// The per-type operator matrix (record_io.proto @internal, DD-005 SD-2)
// — a cross-edition contract T04 mirrors:
//
//	string (incl. enum):          eq, neq, is_in, not_in
//	bool:                         eq, neq
//	integer, number,
//	timestamp, date, time:        eq, neq, gt, gte, lt, lte
//	json:                         not filterable
//	is_null / not_null:           any optional (non-required) field
//	system id:                    eq, is_in
//	system created_at/updated_at: gt, gte, lt, lte (range only)
//	created_by:                   not filterable (attribution is the
//	                              grant system's privacy boundary)
//	partition:                    not filterable (ambient scope set by
//	                              the server, never addressable data)
var (
	equalityOps = map[datastorev1.RecordConditionOp]bool{
		datastorev1.RecordConditionOp_eq:     true,
		datastorev1.RecordConditionOp_neq:    true,
		datastorev1.RecordConditionOp_is_in:  true,
		datastorev1.RecordConditionOp_not_in: true,
	}
	rangeOps = map[datastorev1.RecordConditionOp]bool{
		datastorev1.RecordConditionOp_eq:  true,
		datastorev1.RecordConditionOp_neq: true,
		datastorev1.RecordConditionOp_gt:  true,
		datastorev1.RecordConditionOp_gte: true,
		datastorev1.RecordConditionOp_lt:  true,
		datastorev1.RecordConditionOp_lte: true,
	}
	boolOps = map[datastorev1.RecordConditionOp]bool{
		datastorev1.RecordConditionOp_eq:  true,
		datastorev1.RecordConditionOp_neq: true,
	}
)

// opsForFieldType returns the operator set a declared field type admits
// (null tests handled separately). json returns nil: not filterable.
func opsForFieldType(t datastorev1.FieldType) map[datastorev1.RecordConditionOp]bool {
	switch t {
	case datastorev1.FieldType_string:
		return equalityOps
	case datastorev1.FieldType_bool:
		return boolOps
	case datastorev1.FieldType_integer, datastorev1.FieldType_number,
		datastorev1.FieldType_timestamp, datastorev1.FieldType_date, datastorev1.FieldType_time:
		return rangeOps
	default:
		return nil
	}
}

// BuildConditions validates a find filter against the declared schema —
// field resolution, the caller's column-level read access, the operator
// matrix, and value canonicalization — and returns substrate-ready
// conditions. Conditions AND-combine; the caller composes the own-scope
// conjunction separately (the grammar can neither express nor relax it).
//
// The read-projection check closes the existence oracle: without it, a
// caller barred from reading a field could still probe its values
// through conditions (filter on a hidden phone number, read the match
// count). The filterable system fields (id, created_at, updated_at)
// are always readable and exempt.
func BuildConditions(coll *datastorev1.CollectionDeclaration, proj authz.ReadProjection, filter *datastorev1.RecordFilter) ([]recordstore.Condition, error) {
	conditions := filter.GetConditions()
	out := make([]recordstore.Condition, 0, len(conditions))
	for _, c := range conditions {
		built, err := buildCondition(coll, proj, c)
		if err != nil {
			return nil, err
		}
		out = append(out, built)
	}
	return out, nil
}

func buildCondition(coll *datastorev1.CollectionDeclaration, proj authz.ReadProjection, c *datastorev1.RecordCondition) (recordstore.Condition, error) {
	name := c.GetField()
	op := c.GetOp()

	if system, err := buildSystemCondition(coll, c); system != nil || err != nil {
		if err != nil {
			return recordstore.Condition{}, err
		}
		return *system, nil
	}

	field := schema.FieldByName(coll, name)
	if field == nil {
		return recordstore.Condition{}, dserrors.InvalidFilter(
			"field %q is not declared in collection %q", name, coll.GetName())
	}

	// Contract check order: declared → readable → operator matrix. The
	// field's very usability is denied before its operators are judged.
	if !proj.AllowsField(name) {
		return recordstore.Condition{}, dserrors.InvalidFilter(
			"field %q is not readable under your grant and cannot be used in filter conditions", name)
	}

	if op == datastorev1.RecordConditionOp_is_null || op == datastorev1.RecordConditionOp_not_null {
		if field.GetRequired() {
			return recordstore.Condition{}, dserrors.InvalidFilter(
				"field %q is required and can never be null", name)
		}
		return recordstore.Condition{Field: name, Op: op}, nil
	}

	allowed := opsForFieldType(field.GetType())
	if allowed == nil {
		return recordstore.Condition{}, dserrors.InvalidFilter(
			"field %q of type %s is not filterable", name, field.GetType())
	}
	if !allowed[op] {
		return recordstore.Condition{}, dserrors.InvalidFilter(
			"operator %s is not valid for field %q of type %s", op, name, field.GetType())
	}

	canonicalize := func(v *structpb.Value) (any, error) {
		if v == nil || v.AsInterface() == nil {
			return nil, dserrors.InvalidFilter(
				"operator %s on field %q requires a value", op, name)
		}
		canonical, err := schema.CanonicalizeValue(field, v.AsInterface())
		if err != nil {
			return nil, dserrors.InvalidFilter("%v", err)
		}
		return canonical, nil
	}

	return buildValueCondition(c, false, canonicalize)
}

// buildSystemCondition handles the filterable system fields. It returns
// (nil, nil) when the condition names a declared (non-system) field.
func buildSystemCondition(coll *datastorev1.CollectionDeclaration, c *datastorev1.RecordCondition) (*recordstore.Condition, error) {
	name := c.GetField()
	op := c.GetOp()

	switch name {
	case "id":
		if op != datastorev1.RecordConditionOp_eq && op != datastorev1.RecordConditionOp_is_in {
			return nil, dserrors.InvalidFilter("id supports only eq and is_in, got %s", op)
		}
		cond, err := buildValueCondition(c, true, func(v *structpb.Value) (any, error) {
			s, ok := v.AsInterface().(string)
			if !ok {
				return nil, dserrors.InvalidFilter("id conditions require string values")
			}
			return s, nil
		})
		if err != nil {
			return nil, err
		}
		return &cond, nil

	case "created_at", "updated_at":
		switch op {
		case datastorev1.RecordConditionOp_gt, datastorev1.RecordConditionOp_gte,
			datastorev1.RecordConditionOp_lt, datastorev1.RecordConditionOp_lte:
		default:
			return nil, dserrors.InvalidFilter("%s supports only range operators (gt, gte, lt, lte), got %s", name, op)
		}
		cond, err := buildValueCondition(c, true, func(v *structpb.Value) (any, error) {
			s, ok := v.AsInterface().(string)
			if !ok {
				return nil, dserrors.InvalidFilter("%s conditions require RFC 3339 timestamp strings", name)
			}
			t, err := time.Parse(time.RFC3339Nano, s)
			if err != nil {
				return nil, dserrors.InvalidFilter("%s conditions require RFC 3339 timestamp strings", name)
			}
			// The system columns store the canonical encoding, which
			// compares lexicographically == chronologically.
			return t.UTC().Format(schema.TimestampFormat), nil
		})
		if err != nil {
			return nil, err
		}
		return &cond, nil

	case "created_by", "org", "partition":
		return nil, dserrors.InvalidFilter("field %q is not filterable", name)

	default:
		return nil, nil
	}
}

// buildValueCondition canonicalizes the condition's value(s) per the
// operator arity: values[] for is_in/not_in, value otherwise.
func buildValueCondition(
	c *datastorev1.RecordCondition,
	system bool,
	canonicalize func(*structpb.Value) (any, error),
) (recordstore.Condition, error) {
	cond := recordstore.Condition{Field: c.GetField(), System: system, Op: c.GetOp()}

	if c.GetOp() == datastorev1.RecordConditionOp_is_in || c.GetOp() == datastorev1.RecordConditionOp_not_in {
		if len(c.GetValues()) == 0 {
			return recordstore.Condition{}, dserrors.InvalidFilter(
				"operator %s on field %q requires values", c.GetOp(), c.GetField())
		}
		for _, v := range c.GetValues() {
			canonical, err := canonicalize(v)
			if err != nil {
				return recordstore.Condition{}, err
			}
			cond.Values = append(cond.Values, canonical)
		}
		return cond, nil
	}

	canonical, err := canonicalize(c.GetValue())
	if err != nil {
		return recordstore.Condition{}, err
	}
	cond.Value = canonical
	return cond, nil
}

// BuildOrderBy validates a sort directive: a sortable declared field
// (json is not sortable) that the caller's read grant allows, or a
// system field. Nil input keeps the default ordering (created_at desc,
// id tiebreak). The read-projection check mirrors BuildConditions:
// ordering by a hidden field would leak its relative values.
func BuildOrderBy(coll *datastorev1.CollectionDeclaration, proj authz.ReadProjection, orderBy *datastorev1.RecordOrderBy) (*recordstore.OrderBy, error) {
	if orderBy == nil {
		return nil, nil
	}
	name := orderBy.GetField()
	desc := orderBy.GetDirection() == datastorev1.RecordSortDirection_desc

	switch name {
	case "id", "created_at", "updated_at":
		return &recordstore.OrderBy{Field: name, System: true, Descending: desc}, nil
	case "created_by", "org", "partition":
		return nil, dserrors.InvalidFilter("field %q is not sortable", name)
	}

	field := schema.FieldByName(coll, name)
	if field == nil {
		return nil, dserrors.InvalidFilter(
			"field %q is not declared in collection %q", name, coll.GetName())
	}
	if !proj.AllowsField(name) {
		return nil, dserrors.InvalidFilter(
			"field %q is not readable under your grant and cannot be used in order_by", name)
	}
	if field.GetType() == datastorev1.FieldType_json {
		return nil, dserrors.InvalidFilter("field %q of type json is not sortable", name)
	}
	return &recordstore.OrderBy{Field: name, Descending: desc}, nil
}

// NormalizeLimit applies the pagination defaults: unset (0) becomes
// DefaultFindLimit; the proto already caps values at MaxFindLimit.
func NormalizeLimit(limit int32) int {
	if limit <= 0 {
		return DefaultFindLimit
	}
	if limit > MaxFindLimit {
		return MaxFindLimit
	}
	return int(limit)
}
