// Package records implements the record write/read mechanics of the
// record RPC handlers: payload validation against the declared schema,
// default application, partial merge, constraint evaluation, and
// envelope projection.
//
// Constraint evaluation runs INSIDE the caller's write transaction
// (recordstore.WithWriteTx = BEGIN IMMEDIATE) and within the caller's
// partition — a partition is a separate world (DD-010), so
// exists/not_exists verdicts consult only its records and cannot go
// stale before the write commits. Uniques are never evaluated here —
// they are substrate indexes; this package only maps their violations
// to the declared constraint messages.
//
// Grant enforcement (verb + own scope) is deliberately NOT here — it is
// the handlers' responsibility, so the data mechanics stay identical
// for every writer. Envelope projection is the one grant-adjacent
// mechanic: the handlers resolve the caller's column-level read access
// (authz.ReadProjection) and Envelope applies it mechanically, so every
// response — find results and write echoes alike — carries only the
// fields the caller may read.
package records

import (
	"errors"
	"fmt"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/authz"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/celeval"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/dserrors"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// RecordIDPrefix is the platform id prefix for records (dsr_<ulid>).
const RecordIDPrefix = "dsr"

// BuildInsertFields validates an insert payload against the declared
// schema and returns the canonical field map: system/undeclared names
// rejected, values canonicalized, defaults applied, required fields
// enforced. Explicit nulls on optional fields are dropped (absent and
// null are not distinguished in storage).
func BuildInsertFields(coll *datastorev1.CollectionDeclaration, payload map[string]any) (map[string]any, error) {
	fields, err := canonicalizePayload(coll, payload)
	if err != nil {
		return nil, err
	}

	for _, f := range coll.GetFields() {
		v, present := fields[f.GetName()]
		if present && v != nil {
			continue
		}
		if def := f.GetDefault(); def != nil && !present {
			canonical, err := schema.CanonicalizeValue(f, def.AsInterface())
			if err != nil {
				// Defaults are validated at apply time; failure here is a defect.
				return nil, fmt.Errorf("default for field %q is invalid: %w", f.GetName(), err)
			}
			fields[f.GetName()] = canonical
			continue
		}
		if f.GetRequired() {
			return nil, dserrors.InvalidRecord("field %q is required", f.GetName())
		}
		delete(fields, f.GetName())
	}

	return fields, nil
}

// MergeUpdateFields applies a partial-merge patch to a record's stored
// fields: only supplied fields change, an explicit null clears a field,
// and required fields cannot be cleared. Constraints evaluate on the
// merged result, which this returns.
func MergeUpdateFields(coll *datastorev1.CollectionDeclaration, stored, patch map[string]any) (map[string]any, error) {
	canonical, err := canonicalizePayload(coll, patch)
	if err != nil {
		return nil, err
	}

	merged, err := TypedFields(coll, stored)
	if err != nil {
		return nil, err
	}

	for name, v := range canonical {
		if v == nil {
			field := schema.FieldByName(coll, name)
			if field.GetRequired() {
				return nil, dserrors.InvalidRecord("field %q is required and cannot be cleared", name)
			}
			delete(merged, name)
			continue
		}
		merged[name] = v
	}

	return merged, nil
}

// canonicalizePayload validates every payload entry: system field names
// rejected, undeclared names rejected, values canonicalized. Explicit
// nulls pass through as nil so callers can distinguish clear-intent
// (updates) and drop them (inserts).
func canonicalizePayload(coll *datastorev1.CollectionDeclaration, payload map[string]any) (map[string]any, error) {
	out := make(map[string]any, len(payload))
	for name, v := range payload {
		if schema.ReservedFieldNames[name] {
			return nil, dserrors.InvalidRecord("field %q is server-managed and cannot be written", name)
		}
		field := schema.FieldByName(coll, name)
		if field == nil {
			return nil, dserrors.InvalidRecord("field %q is not declared in collection %q", name, coll.GetName())
		}
		if v == nil {
			out[name] = nil
			continue
		}
		canonical, err := schema.CanonicalizeValue(field, v)
		if err != nil {
			return nil, dserrors.InvalidRecord("%v", err)
		}
		out[name] = canonical
	}
	return out, nil
}

// TypedFields re-types a record's stored fields against the declared
// schema (json.Number → int64/float64). Stored fields no longer declared
// (removed from the schema) are projected out — retained invisibly in
// storage per the sync change matrix, but never surfaced.
func TypedFields(coll *datastorev1.CollectionDeclaration, stored map[string]any) (map[string]any, error) {
	out := make(map[string]any, len(stored))
	for _, f := range coll.GetFields() {
		raw, ok := stored[f.GetName()]
		if !ok || raw == nil {
			continue
		}
		typed, err := schema.FromStored(f, raw)
		if err != nil {
			return nil, err
		}
		out[f.GetName()] = typed
	}
	return out, nil
}

// NewRecord assembles a store record with server-stamped system fields.
func NewRecord(subject *datastorev1.DatastoreSubject, org, partition string, fields map[string]any) *recordstore.Record {
	now := time.Now().UTC()
	return &recordstore.Record{
		ID:           steps.GenerateID(RecordIDPrefix),
		CreatedAt:    now,
		UpdatedAt:    now,
		CreatedBy:    subject,
		CreatedByKey: identity.SubjectKey(subject),
		Org:          org,
		Partition:    partition,
		Fields:       fields,
	}
}

// NormalizePartition canonicalizes a request's partition: unset means
// the shared default partition.
func NormalizePartition(partition string) string {
	if partition == "" {
		return recordstore.DefaultPartition
	}
	return partition
}

// EvaluateConstraints evaluates the collection's check, exists, and
// not_exists constraints against the candidate fields, inside the
// caller's write transaction and within the caller's partition. The
// first violation returns the declared message as FAILED_PRECONDITION.
func EvaluateConstraints(
	tx recordstore.Tx,
	datastore *datastorev1.Datastore,
	coll *datastorev1.CollectionDeclaration,
	partition string,
	candidate map[string]any,
) error {
	tz := datastore.GetSpec().GetTimezone()
	this := celeval.ActivationFromRecord(coll, candidate)

	for _, chk := range coll.GetChecks() {
		applies, err := evaluateWhen(chk.GetWhen(), this, tz)
		if err != nil {
			return constraintEvalError(chk.GetName(), err)
		}
		if !applies {
			continue
		}
		ok, err := celeval.EvaluateBool(chk.GetExpression(), this, nil, tz)
		if err != nil {
			return constraintEvalError(chk.GetName(), err)
		}
		if !ok {
			return dserrors.CheckViolation(chk.GetName(), chk.GetMessage())
		}
	}

	for _, ex := range coll.GetExists() {
		applies, err := evaluateWhen(ex.GetWhen(), this, tz)
		if err != nil {
			return constraintEvalError(ex.GetName(), err)
		}
		if !applies {
			continue
		}
		matched, err := anyTargetMatches(tx, datastore, ex, partition, this, tz)
		if err != nil {
			return err
		}
		if !matched {
			return dserrors.CheckViolation(ex.GetName(), ex.GetMessage())
		}
	}

	for _, ex := range coll.GetNotExists() {
		applies, err := evaluateWhen(ex.GetWhen(), this, tz)
		if err != nil {
			return constraintEvalError(ex.GetName(), err)
		}
		if !applies {
			continue
		}
		matched, err := anyTargetMatches(tx, datastore, ex, partition, this, tz)
		if err != nil {
			return err
		}
		if matched {
			return dserrors.CheckViolation(ex.GetName(), ex.GetMessage())
		}
	}

	return nil
}

// anyTargetMatches reports whether any record of the constraint's target
// collection — within the caller's partition — satisfies the where
// expression against the candidate. It runs inside the write
// transaction, so the verdict cannot go stale before commit.
func anyTargetMatches(
	tx recordstore.Tx,
	datastore *datastorev1.Datastore,
	ex *datastorev1.ExistsConstraint,
	partition string,
	this map[string]any,
	tz string,
) (bool, error) {
	target := schema.CollectionByName(datastore.GetSpec(), ex.GetCollection())
	if target == nil {
		return false, fmt.Errorf("exists constraint %q references unknown collection %q", ex.GetName(), ex.GetCollection())
	}

	candidates, err := tx.List(datastore.GetMetadata().GetId(), target.GetName(), partition)
	if err != nil {
		return false, fmt.Errorf("failed to load %q for constraint %q: %w", target.GetName(), ex.GetName(), err)
	}

	for _, rec := range candidates {
		typed, err := TypedFields(target, rec.Fields)
		if err != nil {
			return false, err
		}
		that := celeval.ActivationFromRecord(target, typed)
		ok, err := celeval.EvaluateBool(ex.GetWhere(), this, that, tz)
		if err != nil {
			return false, constraintEvalError(ex.GetName(), err)
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

func evaluateWhen(when string, this map[string]any, tz string) (bool, error) {
	if when == "" {
		return true, nil
	}
	return celeval.EvaluateBool(when, this, nil, tz)
}

// constraintEvalError wraps a runtime CEL evaluation failure (e.g. a
// comparison against null). Expressions compile at apply time, so this
// is a data-dependent failure; it surfaces as FAILED_PRECONDITION with
// the constraint name for diagnosability rather than an opaque internal.
func constraintEvalError(constraint string, err error) error {
	return dserrors.CheckViolation(constraint,
		fmt.Sprintf("constraint %q could not be evaluated against this record: %v", constraint, err))
}

// MapUniqueViolation resolves a recordstore unique-violation error to
// the declared constraint's ALREADY_EXISTS contract error. Other errors
// pass through unchanged.
func MapUniqueViolation(err error, coll *datastorev1.CollectionDeclaration) error {
	var violation *recordstore.UniqueViolationError
	if !errors.As(err, &violation) {
		return err
	}
	for _, u := range coll.GetUniques() {
		if u.GetName() == violation.Constraint {
			return dserrors.UniqueViolation(u.GetName(), u.GetMessage())
		}
	}
	// An index exists that the spec no longer declares — a sync defect.
	return fmt.Errorf("record violated unique index %q which has no declared constraint", violation.Constraint)
}

// Envelope projects a store record into the RecordEnvelope contract
// shape: canonical encodings inside a Struct, absent fields omitted,
// limited to the caller's column-level read access. The projection
// applies to every response — find results and write echoes alike — so
// a caller never receives a field its read grant does not allow; the
// zero-value projection (no read grant) yields id and timestamps only.
func Envelope(coll *datastorev1.CollectionDeclaration, rec *recordstore.Record, proj authz.ReadProjection) (*datastorev1.RecordEnvelope, error) {
	typed, err := TypedFields(coll, rec.Fields)
	if err != nil {
		return nil, err
	}

	structFields := make(map[string]*structpb.Value, len(typed))
	for name, v := range typed {
		if !proj.AllowsField(name) {
			continue
		}
		value, err := structpb.NewValue(structValue(v))
		if err != nil {
			return nil, fmt.Errorf("failed to encode field %q: %w", name, err)
		}
		structFields[name] = value
	}

	envelope := &datastorev1.RecordEnvelope{
		Id:        rec.ID,
		CreatedAt: timestamppb.New(rec.CreatedAt),
		UpdatedAt: timestamppb.New(rec.UpdatedAt),
		Fields:    &structpb.Struct{Fields: structFields},
	}
	// created_by is the attribution subject — for channel senders the
	// phone number, the most direct PII in the envelope. It rides only
	// when the caller's read grant exposes it.
	if proj.AllowsCreatedBy() {
		envelope.CreatedBy = rec.CreatedBy
	}
	return envelope, nil
}

// structValue converts canonical Go values to structpb-compatible ones
// (structpb has no integer kind; int64 rides as float64, exact for the
// JSON-representable range).
func structValue(v any) any {
	if i, ok := v.(int64); ok {
		return float64(i)
	}
	return v
}
