// Package recordstore is the OSS storage substrate for datastore
// records: one SQLite table per (datastore, collection) in stigmer.db,
// created at runtime by the schema-sync step (DD-007).
//
// Layering: this package stores and retrieves record envelopes and
// enforces exactly one constraint class — uniques, as substrate indexes
// (partial expression indexes over json_extract). Everything else
// (grants, CEL checks, exists/not_exists, filter validation) is domain
// logic ABOVE this interface, so the Go and Java implementations stay
// algorithm-identical while the substrate differs.
//
// Isolation: all writes run inside BEGIN IMMEDIATE transactions
// (WithWriteTx), which take SQLite's single write lock up front. Domain
// exists/not_exists checks evaluated inside the transaction therefore
// cannot race a concurrent write — the contract's no-stale-exists-check
// clause. The store owns its own *sql.DB handle (the core store's
// write mutex does not cover these tables).
package recordstore

import (
	"context"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
)

// DefaultPartition is the shared data partition: every record operation
// that does not name a partition lands here, so pre-partition behavior
// (all agents, all instances share) is the default, not a mode (DD-010).
const DefaultPartition = "default"

// Record is the stored envelope: server-managed system fields plus the
// declared fields in their canonical encodings (see the schema package).
type Record struct {
	ID        string
	CreatedAt time.Time
	UpdatedAt time.Time
	// CreatedBy is the attribution subject stamped at insert.
	CreatedBy *datastorev1.DatastoreSubject
	// CreatedByKey is the deterministic comparison key derived from
	// CreatedBy (identity.SubjectKey); own-scoped grants filter on it.
	CreatedByKey string
	// Org is the owning organization, stamped from the datastore.
	// Records never cross the org boundary (DD-006).
	Org string
	// Partition is the DD-010 data-partition label, server-derived per
	// call (instance-bound for agent sessions, explicit for direct
	// principals) — ambient scope, never caller data.
	Partition string
	// Fields holds declared field values in canonical encodings.
	// Absent and null are not distinguished in storage.
	Fields map[string]any
}

// Condition is one validated filter predicate. The domain layer
// type-checks conditions against the declared schema (operator matrix,
// canonical value encodings) before they reach the store.
type Condition struct {
	// Field is the declared field name, or a system column when System.
	Field string
	// System marks id/created_at/updated_at conditions (real columns
	// rather than json_extract paths).
	System bool
	Op     datastorev1.RecordConditionOp
	// Value is the canonical comparison value for scalar operators.
	Value any
	// Values are the canonical values for is_in / not_in.
	Values []any
}

// OrderBy is a validated sort directive.
type OrderBy struct {
	Field      string
	System     bool
	Descending bool
}

// FindQuery selects records from one collection, within one partition.
type FindQuery struct {
	DatastoreID string
	Collection  string
	// Partition scopes the query; callers always resolve it (empty is a
	// caller defect, not "all partitions" — cross-partition reads do not
	// exist on any record surface).
	Partition  string
	Conditions []Condition
	// OwnerKey, when non-empty, composes an own-scope conjunction the
	// filter grammar cannot express or relax: created_by_key = OwnerKey.
	OwnerKey string
	// OrderBy is optional; the default is created_at desc, id tiebreak.
	OrderBy *OrderBy
	Limit   int
	Offset  int
}

// UniqueViolationError reports a violated unique constraint, resolved
// from the deterministic index name. The caller maps it to
// ALREADY_EXISTS with the constraint's declared message — raw driver
// errors never cross the record-RPC boundary (DD-007).
type UniqueViolationError struct {
	// Constraint is the declared UniqueConstraint name.
	Constraint string
}

func (e *UniqueViolationError) Error() string {
	return "unique constraint violated: " + e.Constraint
}

// Store is the OSS record substrate.
type Store interface {
	// WithWriteTx runs fn inside a BEGIN IMMEDIATE transaction,
	// committing on nil and rolling back on error. Both record writes
	// and schema-sync DDL run through it, so constraint evaluation and
	// index provisioning are atomic with the changes they guard.
	WithWriteTx(ctx context.Context, fn func(tx Tx) error) error

	// Find returns one page of records plus the total match count,
	// scoped to the query's partition.
	Find(ctx context.Context, q FindQuery) ([]*Record, int64, error)

	// Get returns a record by id within a partition, or nil when absent
	// (a record living in another partition is absent by design).
	Get(ctx context.Context, datastoreID, collection, partition, id string) (*Record, error)

	// CountRecords returns the number of records in a collection across
	// all partitions (delete guards and removal counts are
	// whole-collection facts).
	CountRecords(ctx context.Context, datastoreID, collection string) (int64, error)

	// ListPartitions returns the datastore's cataloged partition labels
	// (the DescribeDatastore projection; empty until the first sync).
	ListPartitions(ctx context.Context, datastoreID string) ([]string, error)

	// Close releases the store's database handle.
	Close() error
}

// Tx is the transactional surface available inside WithWriteTx.
type Tx interface {
	// EnsureCollectionTable creates the collection's table and its
	// system indexes (ordering, attribution) if absent. The returned
	// flag reports whether the table was created by THIS call — the
	// substrate-derived materialization fact the sync report's
	// materialized_at is stamped from.
	EnsureCollectionTable(datastoreID, collection string) (created bool, err error)

	// EnsurePartition registers a partition label in the datastore's
	// catalog (creating the catalog on first use). Partitions are
	// labels, never objects: no per-partition DDL exists — the catalog
	// row is the whole materialization (DD-010). Idempotent; returns
	// whether THIS call registered the label.
	EnsurePartition(datastoreID, partition string) (created bool, err error)

	// ListPartitions returns the datastore's cataloged partition labels.
	ListPartitions(datastoreID string) ([]string, error)

	// DropPartitionCatalog removes the datastore's partition catalog.
	// Only the datastore's guarded delete calls it, alongside
	// DropCollectionTable.
	DropPartitionCatalog(datastoreID string) error

	// UniqueIndexConstraints returns the declared-constraint names of
	// the unique indexes currently provisioned for a collection.
	UniqueIndexConstraints(datastoreID, collection string) ([]string, error)

	// CreateUniqueIndex provisions the (possibly partial) unique index
	// for a declared constraint. Existing data violating the constraint
	// fails the create (the sync step pre-counts violations for its
	// rejection message).
	CreateUniqueIndex(datastoreID, collection string, u *datastorev1.UniqueConstraint, whereEquals any) error

	// DropUniqueIndex removes a constraint's index.
	DropUniqueIndex(datastoreID, collection, constraint string) error

	// DropCollectionTable removes a collection's table and indexes.
	DropCollectionTable(datastoreID, collection string) error

	// ListCollectionTables returns the collection names that have
	// materialized tables for a datastore — the substrate's own truth,
	// including collections removed from the spec whose data is
	// retained. The datastore delete path drops exactly this set.
	ListCollectionTables(datastoreID string) ([]string, error)

	// CountUniqueViolations counts existing records that violate a
	// prospective unique constraint (records beyond the first in each
	// duplicate group).
	CountUniqueViolations(datastoreID, collection string, u *datastorev1.UniqueConstraint, whereEquals any) (int64, error)

	// List returns records of a collection, ordered by (created_at, id),
	// inside the write lock. A non-empty partition scopes the list (the
	// bounded exists/not_exists evaluation — constraints see one
	// partition's world); empty means all partitions (sync-time
	// constraint validation — a schema change must hold against every
	// record it will govern, whichever partition holds it).
	List(datastoreID, collection, partition string) ([]*Record, error)

	// Get returns a record by id within a partition, or nil when absent.
	Get(datastoreID, collection, partition, id string) (*Record, error)

	// CountRecords returns the number of records in a collection.
	CountRecords(datastoreID, collection string) (int64, error)

	// Insert stores a new record. A violated unique constraint returns
	// *UniqueViolationError.
	Insert(datastoreID, collection string, rec *Record) error

	// Update replaces a record's fields and updated_at. A violated
	// unique constraint returns *UniqueViolationError.
	Update(datastoreID, collection string, rec *Record) error

	// Delete removes a record by id.
	Delete(datastoreID, collection, id string) error
}
