package recordstore

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/datastore/schema"
	"google.golang.org/protobuf/proto"

	// Pure Go SQLite driver, registered as "sqlite" (same driver as the
	// core resource store).
	_ "modernc.org/sqlite"
)

// Identifier prefixes. Datastore ids (dst_<ulid>), collection names, and
// constraint names are all validated to [a-z0-9_]+, so composed
// identifiers are injection-safe by construction.
//
// The partition catalog deliberately does NOT share the record-table
// prefix: a user collection may legally be named "partitions", so
// "rec_<dsid>_partitions" is a real record table and the catalog must
// live outside that namespace for ListCollectionTables to stay truthful.
const (
	tablePrefix            = "rec_"
	uniqueIndexPrefix      = "uq_"
	partitionCatalogPrefix = "dsp_"
)

// sqliteStore implements Store over its own *sql.DB handle to
// stigmer.db.
//
// The handle is configured at the DSN level so every pooled connection
// carries the pragmas, and _txlock=immediate makes database/sql
// transactions BEGIN IMMEDIATE — the write lock is taken up front, so
// domain constraint checks inside WithWriteTx cannot race a concurrent
// writer (they serialize on SQLite's single write lock, waiting up to
// busy_timeout).
type sqliteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens the record substrate on the given database file
// (the same stigmer.db the core resource store uses).
func NewSQLiteStore(dbPath string) (Store, error) {
	dsn := dbPath + "?_txlock=immediate" +
		"&_pragma=busy_timeout(5000)" +
		"&_pragma=journal_mode(WAL)" +
		"&_pragma=synchronous(NORMAL)" +
		"&_pragma=foreign_keys(ON)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open record store database: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to connect to record store database: %w", err)
	}
	return &sqliteStore{db: db}, nil
}

func (s *sqliteStore) Close() error {
	return s.db.Close()
}

func (s *sqliteStore) WithWriteTx(ctx context.Context, fn func(tx Tx) error) error {
	sqlTx, err := s.db.BeginTx(ctx, nil) // BEGIN IMMEDIATE via _txlock DSN option
	if err != nil {
		return fmt.Errorf("failed to begin record transaction: %w", err)
	}
	if err := fn(&sqliteTx{tx: sqlTx}); err != nil {
		if rbErr := sqlTx.Rollback(); rbErr != nil && rbErr != sql.ErrTxDone {
			return fmt.Errorf("%w (rollback also failed: %v)", err, rbErr)
		}
		return err
	}
	if err := sqlTx.Commit(); err != nil {
		return fmt.Errorf("failed to commit record transaction: %w", err)
	}
	return nil
}

func (s *sqliteStore) Find(ctx context.Context, q FindQuery) ([]*Record, int64, error) {
	table := tableName(q.DatastoreID, q.Collection)

	where, args := buildWhere(q.Partition, q.Conditions, q.OwnerKey)

	var total int64
	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM %q %s`, table, where)
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count records: %w", err)
	}

	orderBy := `ORDER BY created_at DESC, id ASC`
	if q.OrderBy != nil {
		dir := "ASC"
		if q.OrderBy.Descending {
			dir = "DESC"
		}
		col := jsonFieldExpr(q.OrderBy.Field)
		if q.OrderBy.System {
			col = fmt.Sprintf("%q", q.OrderBy.Field)
		}
		// id tiebreak keeps pagination deterministic under equal keys.
		orderBy = fmt.Sprintf(`ORDER BY %s %s, id ASC`, col, dir)
	}

	query := fmt.Sprintf(
		`SELECT `+recordColumns+` FROM %q %s %s LIMIT ? OFFSET ?`,
		table, where, orderBy,
	)
	rows, err := s.db.QueryContext(ctx, query, append(args, q.Limit, q.Offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query records: %w", err)
	}
	defer rows.Close()

	var records []*Record
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, 0, err
		}
		records = append(records, rec)
	}
	return records, total, rows.Err()
}

func (s *sqliteStore) Get(ctx context.Context, datastoreID, collection, partition, id string) (*Record, error) {
	return getRecord(ctx, s.db, datastoreID, collection, partition, id)
}

func (s *sqliteStore) CountRecords(ctx context.Context, datastoreID, collection string) (int64, error) {
	var n int64
	query := fmt.Sprintf(`SELECT COUNT(*) FROM %q`, tableName(datastoreID, collection))
	if err := s.db.QueryRowContext(ctx, query).Scan(&n); err != nil {
		return 0, fmt.Errorf("failed to count records: %w", err)
	}
	return n, nil
}

func (s *sqliteStore) ListPartitions(ctx context.Context, datastoreID string) ([]string, error) {
	catalog := partitionCatalogName(datastoreID)

	// The catalog materializes with the first sync; before that the
	// datastore has no partitions to report.
	var exists int
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, catalog,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("failed to check partition catalog %s: %w", catalog, err)
	}
	if exists == 0 {
		return nil, nil
	}

	rows, err := s.db.QueryContext(ctx, fmt.Sprintf(`SELECT partition FROM %q ORDER BY partition`, catalog))
	if err != nil {
		return nil, fmt.Errorf("failed to list partitions: %w", err)
	}
	defer rows.Close()

	var partitions []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		partitions = append(partitions, p)
	}
	return partitions, rows.Err()
}

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

type sqliteTx struct {
	tx *sql.Tx
}

func (t *sqliteTx) EnsureCollectionTable(datastoreID, collection string) (bool, error) {
	table := tableName(datastoreID, collection)

	// The "did this call materialize the table" fact is derived from the
	// substrate inside the same transaction (never from status), so the
	// materialized_at stamp and the DDL commit or roll back together.
	var existing int
	if err := t.tx.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, table,
	).Scan(&existing); err != nil {
		return false, fmt.Errorf("failed to check collection table %s: %w", table, err)
	}
	if existing > 0 {
		return false, nil
	}

	// created_at/updated_at store the canonical timestamp encoding
	// (schema.TimestampFormat), which sorts lexicographically ==
	// chronologically. created_by is the proto-marshaled attribution
	// subject; created_by_key its comparison key for own-scope filters.
	// partition is the DD-010 label — every index leads with it because
	// every record operation is partition-scoped.
	ddl := fmt.Sprintf(`CREATE TABLE %q (
		id TEXT PRIMARY KEY,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		created_by BLOB NOT NULL,
		created_by_key TEXT NOT NULL,
		org TEXT NOT NULL,
		partition TEXT NOT NULL,
		fields TEXT NOT NULL CHECK (json_valid(fields))
	)`, table)
	if _, err := t.tx.Exec(ddl); err != nil {
		return false, fmt.Errorf("failed to create collection table %s: %w", table, err)
	}

	orderIdx := fmt.Sprintf(`CREATE INDEX %q ON %q (partition, created_at DESC, id)`,
		"ord_"+table, table)
	if _, err := t.tx.Exec(orderIdx); err != nil {
		return false, fmt.Errorf("failed to create ordering index on %s: %w", table, err)
	}

	ownerIdx := fmt.Sprintf(`CREATE INDEX %q ON %q (partition, created_by_key)`,
		"own_"+table, table)
	if _, err := t.tx.Exec(ownerIdx); err != nil {
		return false, fmt.Errorf("failed to create attribution index on %s: %w", table, err)
	}
	return true, nil
}

func (t *sqliteTx) EnsurePartition(datastoreID, partition string) (bool, error) {
	catalog := partitionCatalogName(datastoreID)

	ddl := fmt.Sprintf(`CREATE TABLE IF NOT EXISTS %q (
		partition TEXT PRIMARY KEY,
		created_at TEXT NOT NULL
	)`, catalog)
	if _, err := t.tx.Exec(ddl); err != nil {
		return false, fmt.Errorf("failed to create partition catalog %s: %w", catalog, err)
	}

	res, err := t.tx.Exec(
		fmt.Sprintf(`INSERT OR IGNORE INTO %q (partition, created_at) VALUES (?, ?)`, catalog),
		partition, time.Now().UTC().Format(schema.TimestampFormat),
	)
	if err != nil {
		return false, fmt.Errorf("failed to register partition %q: %w", partition, err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("failed to register partition %q: %w", partition, err)
	}
	return n > 0, nil
}

func (t *sqliteTx) ListPartitions(datastoreID string) ([]string, error) {
	catalog := partitionCatalogName(datastoreID)

	var exists int
	if err := t.tx.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, catalog,
	).Scan(&exists); err != nil {
		return nil, fmt.Errorf("failed to check partition catalog %s: %w", catalog, err)
	}
	if exists == 0 {
		return nil, nil
	}

	rows, err := t.tx.Query(fmt.Sprintf(`SELECT partition FROM %q ORDER BY partition`, catalog))
	if err != nil {
		return nil, fmt.Errorf("failed to list partitions: %w", err)
	}
	defer rows.Close()

	var partitions []string
	for rows.Next() {
		var p string
		if err := rows.Scan(&p); err != nil {
			return nil, err
		}
		partitions = append(partitions, p)
	}
	return partitions, rows.Err()
}

func (t *sqliteTx) DropPartitionCatalog(datastoreID string) error {
	catalog := partitionCatalogName(datastoreID)
	if _, err := t.tx.Exec(fmt.Sprintf(`DROP TABLE IF EXISTS %q`, catalog)); err != nil {
		return fmt.Errorf("failed to drop partition catalog %s: %w", catalog, err)
	}
	return nil
}

func (t *sqliteTx) UniqueIndexConstraints(datastoreID, collection string) ([]string, error) {
	table := tableName(datastoreID, collection)
	prefix := uniqueIndexPrefix + table + "_"

	rows, err := t.tx.Query(
		`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name LIKE ?`,
		table, prefix+"%",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list unique indexes for %s: %w", table, err)
	}
	defer rows.Close()

	var constraints []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		constraints = append(constraints, strings.TrimPrefix(name, prefix))
	}
	return constraints, rows.Err()
}

func (t *sqliteTx) CreateUniqueIndex(datastoreID, collection string, u *datastorev1.UniqueConstraint, whereEquals any) error {
	table := tableName(datastoreID, collection)

	// The partition column leads every unique index: uniqueness is a
	// per-partition invariant — partitions are separate worlds, so the
	// same key in two partitions never conflicts (DD-010).
	exprs := make([]string, 0, len(u.GetFields())+1)
	exprs = append(exprs, "partition")
	for _, f := range u.GetFields() {
		exprs = append(exprs, jsonFieldExpr(f))
	}

	ddl := fmt.Sprintf(`CREATE UNIQUE INDEX %q ON %q (%s)`,
		uniqueIndexName(datastoreID, collection, u.GetName()), table, strings.Join(exprs, ", "))
	if where := u.GetWhere(); where != nil {
		// DDL cannot bind parameters; the literal is rendered from the
		// canonical (schema-validated) value.
		ddl += fmt.Sprintf(" WHERE %s = %s", jsonFieldExpr(where.GetField()), sqlLiteral(whereEquals))
	}

	if _, err := t.tx.Exec(ddl); err != nil {
		return fmt.Errorf("failed to create unique index for constraint %q on %s: %w", u.GetName(), table, err)
	}
	return nil
}

func (t *sqliteTx) DropUniqueIndex(datastoreID, collection, constraint string) error {
	name := uniqueIndexName(datastoreID, collection, constraint)
	if _, err := t.tx.Exec(fmt.Sprintf(`DROP INDEX IF EXISTS %q`, name)); err != nil {
		return fmt.Errorf("failed to drop unique index %s: %w", name, err)
	}
	return nil
}

func (t *sqliteTx) DropCollectionTable(datastoreID, collection string) error {
	table := tableName(datastoreID, collection)
	if _, err := t.tx.Exec(fmt.Sprintf(`DROP TABLE IF EXISTS %q`, table)); err != nil {
		return fmt.Errorf("failed to drop collection table %s: %w", table, err)
	}
	return nil
}

func (t *sqliteTx) ListCollectionTables(datastoreID string) ([]string, error) {
	prefix := tablePrefix + datastoreID + "_"
	rows, err := t.tx.Query(
		`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?`, prefix+"%",
	)
	if err != nil {
		return nil, fmt.Errorf("failed to list collection tables: %w", err)
	}
	defer rows.Close()

	var collections []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		collections = append(collections, strings.TrimPrefix(name, prefix))
	}
	return collections, rows.Err()
}

func (t *sqliteTx) CountUniqueViolations(datastoreID, collection string, u *datastorev1.UniqueConstraint, whereEquals any) (int64, error) {
	table := tableName(datastoreID, collection)

	exprs := make([]string, len(u.GetFields()))
	notNull := make([]string, len(u.GetFields()))
	for i, f := range u.GetFields() {
		exprs[i] = jsonFieldExpr(f)
		// SQLite unique indexes treat NULL keys as distinct, but GROUP BY
		// treats NULLs as equal; exclude NULL-keyed rows to mirror the
		// index semantics the constraint will actually enforce.
		notNull[i] = exprs[i] + " IS NOT NULL"
	}

	where := strings.Join(notNull, " AND ")
	var args []any
	if uw := u.GetWhere(); uw != nil {
		where += fmt.Sprintf(" AND %s = ?", jsonFieldExpr(uw.GetField()))
		args = append(args, bindValue(whereEquals))
	}

	// Violating records = every record beyond the first in each
	// duplicate group (the count the sync rejection message reports).
	// Groups include the partition to mirror the per-partition index
	// semantics the constraint will actually enforce.
	query := fmt.Sprintf(
		`SELECT COALESCE(SUM(cnt - 1), 0) FROM (
			SELECT COUNT(*) AS cnt FROM %q WHERE %s GROUP BY partition, %s HAVING COUNT(*) > 1
		)`,
		table, where, strings.Join(exprs, ", "),
	)

	var n int64
	if err := t.tx.QueryRow(query, args...).Scan(&n); err != nil {
		return 0, fmt.Errorf("failed to count unique violations for %q on %s: %w", u.GetName(), table, err)
	}
	return n, nil
}

func (t *sqliteTx) List(datastoreID, collection, partition string) ([]*Record, error) {
	where := ""
	var args []any
	if partition != "" {
		where = `WHERE partition = ?`
		args = append(args, partition)
	}
	query := fmt.Sprintf(
		`SELECT `+recordColumns+` FROM %q %s ORDER BY created_at, id`,
		tableName(datastoreID, collection), where,
	)
	rows, err := t.tx.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list records: %w", err)
	}
	defer rows.Close()

	var records []*Record
	for rows.Next() {
		rec, err := scanRecord(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, rec)
	}
	return records, rows.Err()
}

func (t *sqliteTx) Get(datastoreID, collection, partition, id string) (*Record, error) {
	return getRecord(context.Background(), t.tx, datastoreID, collection, partition, id)
}

func (t *sqliteTx) CountRecords(datastoreID, collection string) (int64, error) {
	var n int64
	query := fmt.Sprintf(`SELECT COUNT(*) FROM %q`, tableName(datastoreID, collection))
	if err := t.tx.QueryRow(query).Scan(&n); err != nil {
		return 0, fmt.Errorf("failed to count records: %w", err)
	}
	return n, nil
}

func (t *sqliteTx) Insert(datastoreID, collection string, rec *Record) error {
	table := tableName(datastoreID, collection)

	createdBy, err := proto.Marshal(rec.CreatedBy)
	if err != nil {
		return fmt.Errorf("failed to marshal record attribution: %w", err)
	}
	fieldsJSON, err := marshalFields(rec.Fields)
	if err != nil {
		return err
	}

	query := fmt.Sprintf(
		`INSERT INTO %q (`+recordColumns+`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		table,
	)
	_, err = t.tx.Exec(query,
		rec.ID,
		rec.CreatedAt.UTC().Format(schema.TimestampFormat),
		rec.UpdatedAt.UTC().Format(schema.TimestampFormat),
		createdBy,
		rec.CreatedByKey,
		rec.Org,
		rec.Partition,
		fieldsJSON,
	)
	if err != nil {
		if violation := parseUniqueViolation(err, datastoreID, collection); violation != nil {
			return violation
		}
		return fmt.Errorf("failed to insert record: %w", err)
	}
	return nil
}

func (t *sqliteTx) Update(datastoreID, collection string, rec *Record) error {
	table := tableName(datastoreID, collection)

	fieldsJSON, err := marshalFields(rec.Fields)
	if err != nil {
		return err
	}

	query := fmt.Sprintf(`UPDATE %q SET updated_at = ?, fields = ? WHERE id = ?`, table)
	res, err := t.tx.Exec(query,
		rec.UpdatedAt.UTC().Format(schema.TimestampFormat),
		fieldsJSON,
		rec.ID,
	)
	if err != nil {
		if violation := parseUniqueViolation(err, datastoreID, collection); violation != nil {
			return violation
		}
		return fmt.Errorf("failed to update record: %w", err)
	}
	if n, err := res.RowsAffected(); err == nil && n == 0 {
		return fmt.Errorf("record %s not found during update", rec.ID)
	}
	return nil
}

func (t *sqliteTx) Delete(datastoreID, collection, id string) error {
	query := fmt.Sprintf(`DELETE FROM %q WHERE id = ?`, tableName(datastoreID, collection))
	if _, err := t.tx.Exec(query, id); err != nil {
		return fmt.Errorf("failed to delete record: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Naming, scanning, and SQL construction
// ---------------------------------------------------------------------------

// recordColumns is the envelope column list, in scanRecord order.
const recordColumns = `id, created_at, updated_at, created_by, created_by_key, org, partition, fields`

func tableName(datastoreID, collection string) string {
	return tablePrefix + datastoreID + "_" + collection
}

func partitionCatalogName(datastoreID string) string {
	return partitionCatalogPrefix + datastoreID
}

// uniqueIndexName is deterministic so a driver violation error resolves
// back to the declared constraint by name alone.
func uniqueIndexName(datastoreID, collection, constraint string) string {
	return uniqueIndexPrefix + tableName(datastoreID, collection) + "_" + constraint
}

// parseUniqueViolation resolves a driver unique-violation error to the
// declared constraint name via the deterministic index name. The driver
// reports expression-index violations as:
//
//	constraint failed: UNIQUE constraint failed: index 'uq_<table>_<constraint>' (2067)
//
// (verified against modernc.org/sqlite). Non-unique errors return nil.
func parseUniqueViolation(err error, datastoreID, collection string) *UniqueViolationError {
	msg := err.Error()
	marker := "UNIQUE constraint failed: index '"
	start := strings.Index(msg, marker)
	if start < 0 {
		return nil
	}
	rest := msg[start+len(marker):]
	end := strings.Index(rest, "'")
	if end < 0 {
		return nil
	}
	indexName := rest[:end]
	prefix := uniqueIndexPrefix + tableName(datastoreID, collection) + "_"
	if !strings.HasPrefix(indexName, prefix) {
		return nil
	}
	return &UniqueViolationError{Constraint: strings.TrimPrefix(indexName, prefix)}
}

// jsonFieldExpr renders the SQLite expression addressing a declared
// field inside the JSON envelope. Field names are schema-validated to
// [a-z][a-z0-9_]*, so path injection is impossible by construction.
func jsonFieldExpr(field string) string {
	return fmt.Sprintf(`json_extract(fields, '$.%s')`, field)
}

// buildWhere renders the WHERE clause: the partition scope first (every
// record query lives inside exactly one partition), then validated
// conditions, then the optional own-scope conjunction. Conditions are
// already type-checked by the domain layer; values are canonical.
func buildWhere(partition string, conditions []Condition, ownerKey string) (string, []any) {
	clauses := []string{"partition = ?"}
	args := []any{partition}

	for _, c := range conditions {
		col := jsonFieldExpr(c.Field)
		if c.System {
			col = fmt.Sprintf("%q", c.Field)
		}
		switch c.Op {
		case datastorev1.RecordConditionOp_eq:
			clauses = append(clauses, col+" = ?")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_neq:
			// SQL inequality is NULL-blind; a declared neq must also
			// match records where the field is absent (JSON null).
			clauses = append(clauses, "("+col+" != ? OR "+col+" IS NULL)")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_gt:
			clauses = append(clauses, col+" > ?")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_gte:
			clauses = append(clauses, col+" >= ?")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_lt:
			clauses = append(clauses, col+" < ?")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_lte:
			clauses = append(clauses, col+" <= ?")
			args = append(args, bindValue(c.Value))
		case datastorev1.RecordConditionOp_is_in:
			placeholders := make([]string, len(c.Values))
			for i, v := range c.Values {
				placeholders[i] = "?"
				args = append(args, bindValue(v))
			}
			clauses = append(clauses, col+" IN ("+strings.Join(placeholders, ", ")+")")
		case datastorev1.RecordConditionOp_not_in:
			placeholders := make([]string, len(c.Values))
			for i, v := range c.Values {
				placeholders[i] = "?"
				args = append(args, bindValue(v))
			}
			clauses = append(clauses, "("+col+" NOT IN ("+strings.Join(placeholders, ", ")+") OR "+col+" IS NULL)")
		case datastorev1.RecordConditionOp_is_null:
			clauses = append(clauses, col+" IS NULL")
		case datastorev1.RecordConditionOp_not_null:
			clauses = append(clauses, col+" IS NOT NULL")
		}
	}

	if ownerKey != "" {
		clauses = append(clauses, "created_by_key = ?")
		args = append(args, ownerKey)
	}

	return "WHERE " + strings.Join(clauses, " AND "), args
}

// bindValue converts a canonical value to its SQLite binding.
// json_extract surfaces JSON booleans as INTEGER 0/1, so bool binds as
// an integer for comparisons to work.
func bindValue(v any) any {
	if b, ok := v.(bool); ok {
		if b {
			return int64(1)
		}
		return int64(0)
	}
	return v
}

// sqlLiteral renders a canonical value as a SQL literal for DDL (index
// WHERE clauses cannot bind parameters). Strings are single-quote
// escaped; the value set is closed by schema.CanonicalizeValue.
func sqlLiteral(v any) string {
	switch val := v.(type) {
	case string:
		return "'" + strings.ReplaceAll(val, "'", "''") + "'"
	case bool:
		if val {
			return "1"
		}
		return "0"
	case int64:
		return fmt.Sprintf("%d", val)
	case float64:
		return fmt.Sprintf("%g", val)
	default:
		// Unreachable for schema-validated values; fail visibly in DDL
		// rather than corrupting the index predicate.
		return "NULL"
	}
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanRecord(row rowScanner) (*Record, error) {
	var (
		rec          Record
		createdAtStr string
		updatedAtStr string
		createdBy    []byte
		fieldsJSON   string
	)
	if err := row.Scan(&rec.ID, &createdAtStr, &updatedAtStr, &createdBy, &rec.CreatedByKey, &rec.Org, &rec.Partition, &fieldsJSON); err != nil {
		return nil, fmt.Errorf("failed to scan record: %w", err)
	}

	createdAt, err := time.Parse(schema.TimestampFormat, createdAtStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse record created_at: %w", err)
	}
	updatedAt, err := time.Parse(schema.TimestampFormat, updatedAtStr)
	if err != nil {
		return nil, fmt.Errorf("failed to parse record updated_at: %w", err)
	}
	rec.CreatedAt = createdAt
	rec.UpdatedAt = updatedAt

	subject := &datastorev1.DatastoreSubject{}
	if err := proto.Unmarshal(createdBy, subject); err != nil {
		return nil, fmt.Errorf("failed to unmarshal record attribution: %w", err)
	}
	rec.CreatedBy = subject

	fields, err := unmarshalFields(fieldsJSON)
	if err != nil {
		return nil, err
	}
	rec.Fields = fields
	return &rec, nil
}

// getRecord loads a record by id within a partition. A record living in
// another partition is reported absent — id-addressed operations must
// never see across the partition boundary.
func getRecord(ctx context.Context, q interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, datastoreID, collection, partition, id string) (*Record, error) {
	query := fmt.Sprintf(
		`SELECT `+recordColumns+` FROM %q WHERE id = ? AND partition = ?`,
		tableName(datastoreID, collection),
	)
	rec, err := scanRecord(q.QueryRowContext(ctx, query, id, partition))
	if err != nil {
		if strings.Contains(err.Error(), sql.ErrNoRows.Error()) {
			return nil, nil
		}
		return nil, err
	}
	return rec, nil
}

func marshalFields(fields map[string]any) (string, error) {
	if fields == nil {
		fields = map[string]any{}
	}
	data, err := json.Marshal(fields)
	if err != nil {
		return "", fmt.Errorf("failed to encode record fields: %w", err)
	}
	return string(data), nil
}

// unmarshalFields decodes with UseNumber so integer fields survive the
// round-trip without float64 precision loss; the domain layer re-types
// values against the declared schema (schema.FromStored).
func unmarshalFields(fieldsJSON string) (map[string]any, error) {
	dec := json.NewDecoder(bytes.NewReader([]byte(fieldsJSON)))
	dec.UseNumber()
	var fields map[string]any
	if err := dec.Decode(&fields); err != nil {
		return nil, fmt.Errorf("failed to decode record fields: %w", err)
	}
	return fields, nil
}
