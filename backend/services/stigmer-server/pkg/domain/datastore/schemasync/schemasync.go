// Package schemasync implements schema sync-on-apply (DD-004 SD-5): the
// synchronous, gating reconciliation of a datastore's declared schema
// with its record substrate.
//
// The entire sync — change-matrix validation, DDL, index provisioning,
// and seed insertion — runs inside ONE immediate write transaction, so
// a rejected sync leaves the substrate untouched (SQLite DDL is
// transactional) and a crash can never half-apply a schema. Provisioning
// is fail-loud: any substrate error fails the RPC (a deliberate
// inversion of the platform's catch-log-continue convention — a
// datastore whose declared uniques are not enforced must not exist).
//
// The additive-plus change matrix (no transition silently destroys or
// nulls data):
//
//   - collection added                      → materialize + seed-once
//   - collection removed (empty)            → allowed; data-free
//   - collection removed (non-empty)        → requires the
//     datastore.stigmer.ai/acknowledge-collection-removal annotation
//     naming it; table retained (data kept, unreachable via record RPCs)
//   - field added (optional, or required with default) → allowed
//   - field added (required, no default) to non-empty  → rejected
//   - field removed                         → allowed; data retained
//     invisibly (redeclaring the same name+type resurfaces it)
//   - field type changed                    → rejected (remove + add
//     under a new name instead)
//   - required tightened / enum narrowed    → validated against existing
//     records first; rejected with the violating count
//   - constraint added or changed           → validated against existing
//     records first; rejected with the violating count
//   - constraint removed                    → allowed (index dropped)
//
// Every rejection message here is cross-edition contract text (T04
// mirrors byte-for-byte).
package schemasync

import (
	"context"
	"fmt"
	"strings"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/celeval"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/identity"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/records"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/recordstore"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// AckCollectionRemovalAnnotation acknowledges removal of the named
// non-empty collection(s) from the spec (comma-separated for multiple).
// It is the console-sendable, YAML-expressible, self-auditing carrier
// chosen by the T02 rulings (R2).
const AckCollectionRemovalAnnotation = "datastore.stigmer.ai/acknowledge-collection-removal"

// RejectionError is a change-matrix rejection: the declared transition
// would destroy or null data (or violate a constraint) and was refused.
// The datastore must retain its prior schema; callers map this to
// FAILED_PRECONDITION.
type RejectionError struct {
	Reason string
}

func (e *RejectionError) Error() string { return e.Reason }

func rejectf(format string, args ...any) error {
	return &RejectionError{Reason: fmt.Sprintf(format, args...)}
}

// Sync reconciles the record substrate with the updated datastore's
// declared schema and returns the status to persist. existing is nil on
// create. On a *RejectionError the substrate is untouched.
func Sync(ctx context.Context, rs recordstore.Store, existing, updated *datastorev1.Datastore) (*datastorev1.DatastoreStatus, error) {
	datastoreID := updated.GetMetadata().GetId()
	spec := updated.GetSpec()

	acked := ackedRemovals(updated)

	type collectionOutcome struct {
		created      bool
		recordCount  int64
		ignoredSeeds int32
	}
	outcomes := map[string]*collectionOutcome{}
	var removedNonEmpty []string

	err := rs.WithWriteTx(ctx, func(tx recordstore.Tx) error {
		// 1. Collection removals (declared before, absent now).
		for _, prior := range existing.GetSpec().GetCollections() {
			if schema.CollectionByName(spec, prior.GetName()) != nil {
				continue
			}
			count, err := tx.CountRecords(datastoreID, prior.GetName())
			if err != nil {
				return err
			}
			if count > 0 && !acked[prior.GetName()] {
				return rejectf(
					"collection %q holds %d records; removing it requires the %s annotation naming it",
					prior.GetName(), count, AckCollectionRemovalAnnotation)
			}
			// Acknowledged (or empty): the table and its data are
			// retained — record RPCs only reach declared collections, so
			// the data goes dark rather than being destroyed. Only the
			// datastore's guarded delete drops tables.
			removedNonEmpty = append(removedNonEmpty, prior.GetName())
		}

		// 2. Per-collection reconciliation.
		for _, coll := range spec.GetCollections() {
			created, err := tx.EnsureCollectionTable(datastoreID, coll.GetName())
			if err != nil {
				return err
			}
			outcome := &collectionOutcome{created: created}
			outcomes[coll.GetName()] = outcome

			prior := schema.CollectionByName(existing.GetSpec(), coll.GetName())

			if err := validateFieldTransitions(tx, datastoreID, prior, coll); err != nil {
				return err
			}
			if err := validateNewCheckConstraints(tx, updated, prior, coll); err != nil {
				return err
			}
			if err := reconcileUniqueIndexes(tx, datastoreID, prior, coll); err != nil {
				return err
			}

			if created && len(coll.GetSeedRecords()) > 0 {
				if err := insertSeeds(tx, updated, coll); err != nil {
					return err
				}
			}
			if !created {
				outcome.ignoredSeeds = int32(len(coll.GetSeedRecords()))
			}

			count, err := tx.CountRecords(datastoreID, coll.GetName())
			if err != nil {
				return err
			}
			outcome.recordCount = count
		}

		return nil
	})
	if err != nil {
		return nil, err
	}

	return buildStatus(existing, spec, removedNonEmpty, func(name string) (bool, int64, int32) {
		o := outcomes[name]
		return o.created, o.recordCount, o.ignoredSeeds
	}), nil
}

// ackedRemovals parses the acknowledgment annotation into the set of
// collection names whose removal the operator has accepted.
func ackedRemovals(d *datastorev1.Datastore) map[string]bool {
	acked := map[string]bool{}
	raw := d.GetMetadata().GetAnnotations()[AckCollectionRemovalAnnotation]
	for _, name := range strings.Split(raw, ",") {
		if name = strings.TrimSpace(name); name != "" {
			acked[name] = true
		}
	}
	return acked
}

// validateFieldTransitions enforces the field-level change matrix
// against the prior declaration and, where a transition tightens what
// existing records must satisfy, against the records themselves.
func validateFieldTransitions(tx recordstore.Tx, datastoreID string, prior, coll *datastorev1.CollectionDeclaration) error {
	count, err := tx.CountRecords(datastoreID, coll.GetName())
	if err != nil {
		return err
	}

	var existingRecords []*recordstore.Record // loaded lazily, once
	loadRecords := func() ([]*recordstore.Record, error) {
		if existingRecords != nil || count == 0 {
			return existingRecords, nil
		}
		existingRecords, err = tx.List(datastoreID, coll.GetName())
		return existingRecords, err
	}

	for _, f := range coll.GetFields() {
		priorField := schema.FieldByName(prior, f.GetName())

		if priorField == nil {
			// Newly declared field (or resurfacing removed data — the
			// matrix treats both as an add; a type mismatch against
			// retained values surfaces per-record on read/write, which
			// redeclare-same-type avoids by definition).
			if f.GetRequired() && f.GetDefault() == nil && count > 0 {
				return rejectf(
					"cannot add required field %q without a default to collection %q holding %d records",
					f.GetName(), coll.GetName(), count)
			}
			continue
		}

		if priorField.GetType() != f.GetType() {
			return rejectf(
				"cannot change type of field %q in collection %q from %s to %s; remove it and declare a new field instead",
				f.GetName(), coll.GetName(), priorField.GetType(), f.GetType())
		}

		// required tightening: every existing record must hold a value.
		if f.GetRequired() && !priorField.GetRequired() && count > 0 {
			recs, err := loadRecords()
			if err != nil {
				return err
			}
			violations := 0
			for _, rec := range recs {
				if v, ok := rec.Fields[f.GetName()]; !ok || v == nil {
					violations++
				}
			}
			if violations > 0 {
				return rejectf(
					"cannot make field %q required in collection %q: %d existing records have no value",
					f.GetName(), coll.GetName(), violations)
			}
		}

		// enum narrowing: no existing record may hold a value outside
		// the new allowed set (an empty prior set means unconstrained).
		if narrowed(priorField.GetEnumValues(), f.GetEnumValues()) && count > 0 {
			allowed := map[string]bool{}
			for _, e := range f.GetEnumValues() {
				allowed[e] = true
			}
			recs, err := loadRecords()
			if err != nil {
				return err
			}
			violations := 0
			for _, rec := range recs {
				if v, ok := rec.Fields[f.GetName()].(string); ok && !allowed[v] {
					violations++
				}
			}
			if violations > 0 {
				return rejectf(
					"cannot narrow enum_values of field %q in collection %q: %d existing records hold removed values",
					f.GetName(), coll.GetName(), violations)
			}
		}
	}

	// Field removals need no per-field action: data is retained
	// invisibly (the read path projects declared fields only).
	return nil
}

// narrowed reports whether the new enum set excludes values the prior
// set allowed (a nil/empty prior set allowed everything).
func narrowed(prior, next []string) bool {
	if len(next) == 0 {
		return false
	}
	if len(prior) == 0 {
		return true
	}
	allowed := map[string]bool{}
	for _, e := range next {
		allowed[e] = true
	}
	for _, e := range prior {
		if !allowed[e] {
			return true
		}
	}
	return false
}

// validateNewCheckConstraints validates added or changed check/exists
// constraints against every existing record, rejecting with the
// violating count (constraint additions never invalidate data
// silently).
func validateNewCheckConstraints(tx recordstore.Tx, updated *datastorev1.Datastore, prior, coll *datastorev1.CollectionDeclaration) error {
	newOrChangedChecks := changedConstraints(prior.GetChecks(), coll.GetChecks())
	newOrChangedExists := changedConstraints(prior.GetExists(), coll.GetExists())
	newOrChangedNotExists := changedConstraints(prior.GetNotExists(), coll.GetNotExists())
	if len(newOrChangedChecks)+len(newOrChangedExists)+len(newOrChangedNotExists) == 0 {
		return nil
	}

	datastoreID := updated.GetMetadata().GetId()
	recs, err := tx.List(datastoreID, coll.GetName())
	if err != nil {
		return err
	}
	if len(recs) == 0 {
		return nil
	}

	tz := updated.GetSpec().GetTimezone()

	countViolations := func(name string, violates func(this map[string]any) (bool, error)) error {
		violations := 0
		for _, rec := range recs {
			typed, err := records.TypedFields(coll, rec.Fields)
			if err != nil {
				return err
			}
			this := celeval.ActivationFromRecord(coll, typed)
			bad, err := violates(this)
			if err != nil {
				return rejectf("constraint %q cannot be evaluated against existing records in %q: %v",
					name, coll.GetName(), err)
			}
			if bad {
				violations++
			}
		}
		if violations > 0 {
			return rejectf("constraint %q is violated by %d existing records in collection %q",
				name, violations, coll.GetName())
		}
		return nil
	}

	for _, chk := range newOrChangedChecks {
		err := countViolations(chk.GetName(), func(this map[string]any) (bool, error) {
			applies, err := evaluateWhen(chk.GetWhen(), this, tz)
			if err != nil || !applies {
				return false, err
			}
			ok, err := celeval.EvaluateBool(chk.GetExpression(), this, nil, tz)
			return err == nil && !ok, err
		})
		if err != nil {
			return err
		}
	}

	validateExistsClass := func(constraints []*datastorev1.ExistsConstraint, wantMatch bool) error {
		for _, ex := range constraints {
			err := countViolations(ex.GetName(), func(this map[string]any) (bool, error) {
				applies, err := evaluateWhen(ex.GetWhen(), this, tz)
				if err != nil || !applies {
					return false, err
				}
				matched, err := existsMatch(tx, updated, ex, this, tz)
				return err == nil && matched != wantMatch, err
			})
			if err != nil {
				return err
			}
		}
		return nil
	}
	if err := validateExistsClass(newOrChangedExists, true); err != nil {
		return err
	}
	return validateExistsClass(newOrChangedNotExists, false)
}

// changedConstraints returns the constraints in next that are absent
// from prior or differ from their prior declaration (proto equality).
func changedConstraints[T proto.Message](prior, next []T) []T {
	priorByName := map[string]T{}
	for _, p := range prior {
		priorByName[constraintName(p)] = p
	}
	var out []T
	for _, n := range next {
		p, ok := priorByName[constraintName(n)]
		if !ok || !proto.Equal(p, n) {
			out = append(out, n)
		}
	}
	return out
}

func constraintName(m proto.Message) string {
	switch c := any(m).(type) {
	case *datastorev1.CheckConstraint:
		return c.GetName()
	case *datastorev1.ExistsConstraint:
		return c.GetName()
	case *datastorev1.UniqueConstraint:
		return c.GetName()
	default:
		return ""
	}
}

func evaluateWhen(when string, this map[string]any, tz string) (bool, error) {
	if when == "" {
		return true, nil
	}
	return celeval.EvaluateBool(when, this, nil, tz)
}

// existsMatch reports whether any record of the constraint's target
// collection satisfies the where expression against the candidate.
func existsMatch(tx recordstore.Tx, updated *datastorev1.Datastore, ex *datastorev1.ExistsConstraint, this map[string]any, tz string) (bool, error) {
	target := schema.CollectionByName(updated.GetSpec(), ex.GetCollection())
	if target == nil {
		return false, fmt.Errorf("constraint %q references unknown collection %q", ex.GetName(), ex.GetCollection())
	}
	candidates, err := tx.List(updated.GetMetadata().GetId(), target.GetName())
	if err != nil {
		return false, err
	}
	for _, rec := range candidates {
		typed, err := records.TypedFields(target, rec.Fields)
		if err != nil {
			return false, err
		}
		that := celeval.ActivationFromRecord(target, typed)
		ok, err := celeval.EvaluateBool(ex.GetWhere(), this, that, tz)
		if err != nil {
			return false, err
		}
		if ok {
			return true, nil
		}
	}
	return false, nil
}

// reconcileUniqueIndexes converges the provisioned unique indexes on the
// declared constraints: added/changed constraints validate existing
// records first (rejecting with the violating count), then (re)create
// their indexes; undeclared indexes drop.
func reconcileUniqueIndexes(tx recordstore.Tx, datastoreID string, prior, coll *datastorev1.CollectionDeclaration) error {
	provisioned, err := tx.UniqueIndexConstraints(datastoreID, coll.GetName())
	if err != nil {
		return err
	}
	provisionedSet := map[string]bool{}
	for _, name := range provisioned {
		provisionedSet[name] = true
	}

	declared := map[string]*datastorev1.UniqueConstraint{}
	for _, u := range coll.GetUniques() {
		declared[u.GetName()] = u
	}

	// Drop indexes for undeclared constraints, and for changed ones
	// (recreated below with the new definition).
	priorByName := map[string]*datastorev1.UniqueConstraint{}
	for _, u := range prior.GetUniques() {
		priorByName[u.GetName()] = u
	}
	for _, name := range provisioned {
		u, stillDeclared := declared[name]
		if stillDeclared {
			if p, ok := priorByName[name]; ok && proto.Equal(p, u) {
				continue // unchanged
			}
		}
		if err := tx.DropUniqueIndex(datastoreID, coll.GetName(), name); err != nil {
			return err
		}
		provisionedSet[name] = false
	}

	for _, u := range coll.GetUniques() {
		if provisionedSet[u.GetName()] {
			continue
		}
		whereEquals, err := uniqueWhereValue(coll, u)
		if err != nil {
			return err
		}
		violations, err := tx.CountUniqueViolations(datastoreID, coll.GetName(), u, whereEquals)
		if err != nil {
			return err
		}
		if violations > 0 {
			return rejectf("constraint %q is violated by %d existing records in collection %q",
				u.GetName(), violations, coll.GetName())
		}
		if err := tx.CreateUniqueIndex(datastoreID, coll.GetName(), u, whereEquals); err != nil {
			return err
		}
	}

	return nil
}

// uniqueWhereValue canonicalizes a partial constraint's where.equals
// value against the field it tests (validated at apply time).
func uniqueWhereValue(coll *datastorev1.CollectionDeclaration, u *datastorev1.UniqueConstraint) (any, error) {
	where := u.GetWhere()
	if where == nil {
		return nil, nil
	}
	field := schema.FieldByName(coll, where.GetField())
	if field == nil {
		return nil, fmt.Errorf("unique constraint %q references unknown field %q", u.GetName(), where.GetField())
	}
	return schema.CanonicalizeValue(field, where.GetEquals().AsInterface())
}

// insertSeeds runs the declared seed records through the full write
// path (defaults, checks, exists, uniques) inside the materializing
// transaction. Attribution is the local operator — honest: the operator
// authored the manifest (seeds bypass grants for the same reason).
func insertSeeds(tx recordstore.Tx, updated *datastorev1.Datastore, coll *datastorev1.CollectionDeclaration) error {
	subject := identity.LocalSubject()
	org := updated.GetMetadata().GetOrg()

	for i, seed := range coll.GetSeedRecords() {
		fields, err := records.BuildInsertFields(coll, seed.AsMap())
		if err != nil {
			return rejectf("seed record %d in collection %q is invalid: %v", i+1, coll.GetName(), err)
		}
		if err := records.EvaluateConstraints(tx, updated, coll, fields); err != nil {
			return rejectf("seed record %d in collection %q violates a constraint: %v", i+1, coll.GetName(), err)
		}
		rec := records.NewRecord(subject, org, fields)
		if err := tx.Insert(updated.GetMetadata().GetId(), coll.GetName(), rec); err != nil {
			mapped := records.MapUniqueViolation(err, coll)
			return rejectf("seed record %d in collection %q could not be inserted: %v", i+1, coll.GetName(), mapped)
		}
	}
	return nil
}

// buildStatus assembles the sync report: declared collections with their
// materialization facts, prior removed entries carried forward, and
// newly removed collections marked.
func buildStatus(
	existing *datastorev1.Datastore,
	spec *datastorev1.DatastoreSpec,
	removed []string,
	outcome func(name string) (created bool, recordCount int64, ignoredSeeds int32),
) *datastorev1.DatastoreStatus {
	now := timestamppb.New(time.Now().UTC())
	priorStatus := map[string]*datastorev1.CollectionStatus{}
	for _, cs := range existing.GetStatus().GetCollections() {
		priorStatus[cs.GetName()] = cs
	}

	status := &datastorev1.DatastoreStatus{
		LastSyncOutcome: datastorev1.DatastoreSyncOutcome_synced,
		LastSyncedAt:    now,
	}

	for _, coll := range spec.GetCollections() {
		created, count, ignored := outcome(coll.GetName())
		cs := &datastorev1.CollectionStatus{
			Name:             coll.GetName(),
			State:            datastorev1.CollectionMaterializationState_active,
			RecordCount:      count,
			IgnoredSeedCount: ignored,
		}
		if created {
			cs.MaterializedAt = now
		} else if prior := priorStatus[coll.GetName()]; prior != nil {
			cs.MaterializedAt = prior.GetMaterializedAt()
		}
		status.Collections = append(status.Collections, cs)
	}

	// Newly removed collections, then prior removed entries carried
	// forward (their tables retain data until the datastore is deleted).
	removedNow := map[string]bool{}
	for _, name := range removed {
		removedNow[name] = true
		cs := &datastorev1.CollectionStatus{
			Name:  name,
			State: datastorev1.CollectionMaterializationState_removed,
		}
		if prior := priorStatus[name]; prior != nil {
			cs.RecordCount = prior.GetRecordCount()
			cs.MaterializedAt = prior.GetMaterializedAt()
		}
		status.Collections = append(status.Collections, cs)
	}
	for _, cs := range existing.GetStatus().GetCollections() {
		if cs.GetState() != datastorev1.CollectionMaterializationState_removed {
			continue
		}
		if removedNow[cs.GetName()] || schema.CollectionByName(spec, cs.GetName()) != nil {
			continue
		}
		status.Collections = append(status.Collections, cs)
	}

	return status
}
