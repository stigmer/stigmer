package recordstore

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"testing"
	"time"

	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	testDatastoreID = "dst_01hqtest0000000000000000"
	testCollection  = "bookings"
)

func newTestStore(t *testing.T) Store {
	t.Helper()
	s, err := NewSQLiteStore(filepath.Join(t.TempDir(), "records.db"))
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func testRecord(id, ownerKey string, fields map[string]any) *Record {
	now := time.Now().UTC()
	return &Record{
		ID:        id,
		CreatedAt: now,
		UpdatedAt: now,
		CreatedBy: &datastorev1.DatastoreSubject{
			Kind: &datastorev1.DatastoreSubject_ChannelSender{
				ChannelSender: &datastorev1.ChannelSenderSubject{SenderKind: "test", Value: ownerKey},
			},
		},
		CreatedByKey: ownerKey,
		Org:          "stigmer",
		Fields:       fields,
	}
}

func mustEnsureTable(t *testing.T, s Store) {
	t.Helper()
	require.NoError(t, s.WithWriteTx(context.Background(), func(tx Tx) error {
		created, err := tx.EnsureCollectionTable(testDatastoreID, testCollection)
		require.NoError(t, err)
		require.True(t, created, "first EnsureCollectionTable must report created")
		return nil
	}))
}

func uniqueSlotConstraint() *datastorev1.UniqueConstraint {
	return &datastorev1.UniqueConstraint{
		Name:    "one_confirmed_per_slot",
		Fields:  []string{"slot_start"},
		Where:   &datastorev1.UniqueWhere{Field: "status", Equals: structpb.NewStringValue("confirmed")},
		Message: "that slot is already booked",
	}
}

func TestEnsureCollectionTable_IdempotentCreatedFlag(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)

	require.NoError(t, s.WithWriteTx(context.Background(), func(tx Tx) error {
		created, err := tx.EnsureCollectionTable(testDatastoreID, testCollection)
		require.NoError(t, err)
		assert.False(t, created, "second EnsureCollectionTable must not report created (seed-once gate)")
		return nil
	}))
}

// TestPartialUniqueIndex_ViolationResolvesConstraintName is the Stage-0
// spike made permanent: modernc.org/sqlite must support partial unique
// indexes over json_extract expressions, and its violation error must
// carry the deterministic index name we parse the constraint from.
func TestPartialUniqueIndex_ViolationResolvesConstraintName(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		return tx.CreateUniqueIndex(testDatastoreID, testCollection, uniqueSlotConstraint(), "confirmed")
	}))

	slot := "2026-07-21T04:30:00.000000000Z"
	insert := func(id, status string) error {
		return s.WithWriteTx(ctx, func(tx Tx) error {
			return tx.Insert(testDatastoreID, testCollection, testRecord(id, "owner-a", map[string]any{
				"slot_start": slot,
				"status":     status,
			}))
		})
	}

	require.NoError(t, insert("dsr_1", "confirmed"))

	// Same slot, same status: the partial index must reject, and the
	// error must resolve to the declared constraint by name.
	err := insert("dsr_2", "confirmed")
	var violation *UniqueViolationError
	require.ErrorAs(t, err, &violation, "duplicate confirmed booking must violate the unique index")
	assert.Equal(t, "one_confirmed_per_slot", violation.Constraint)

	// Same slot, different status: outside the partial index's WHERE.
	require.NoError(t, insert("dsr_3", "cancelled"))
	require.NoError(t, insert("dsr_4", "cancelled"))
}

func TestUniqueIndexLifecycle_ListAndDrop(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		if err := tx.CreateUniqueIndex(testDatastoreID, testCollection, uniqueSlotConstraint(), "confirmed"); err != nil {
			return err
		}
		names, err := tx.UniqueIndexConstraints(testDatastoreID, testCollection)
		require.NoError(t, err)
		assert.Equal(t, []string{"one_confirmed_per_slot"}, names)

		require.NoError(t, tx.DropUniqueIndex(testDatastoreID, testCollection, "one_confirmed_per_slot"))
		names, err = tx.UniqueIndexConstraints(testDatastoreID, testCollection)
		require.NoError(t, err)
		assert.Empty(t, names)
		return nil
	}))
}

func TestCountUniqueViolations_ReportsExistingDuplicates(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		for i, status := range []string{"confirmed", "confirmed", "confirmed", "cancelled"} {
			rec := testRecord(
				// ids must differ; slot is identical for all four
				"dsr_dup_"+string(rune('a'+i)), "owner-a",
				map[string]any{"slot_start": "2026-07-21T04:30:00.000000000Z", "status": status},
			)
			require.NoError(t, tx.Insert(testDatastoreID, testCollection, rec))
		}

		// Three confirmed duplicates in one group → 2 violating records;
		// the cancelled record is outside the partial WHERE.
		n, err := tx.CountUniqueViolations(testDatastoreID, testCollection, uniqueSlotConstraint(), "confirmed")
		require.NoError(t, err)
		assert.Equal(t, int64(2), n)
		return nil
	}))
}

func TestFind_FilterOrderingPaginationAndOwnScope(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	base := time.Date(2026, 7, 21, 10, 0, 0, 0, time.UTC)
	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		for i := 0; i < 5; i++ {
			rec := testRecord("dsr_f"+string(rune('a'+i)), "owner-a", map[string]any{
				"slot_start": base.Add(time.Duration(i) * time.Hour).Format("2006-01-02T15:04:05.000000000Z"),
				"status":     "confirmed",
				"seq":        int64(i),
			})
			if i%2 == 1 {
				rec.CreatedByKey = "owner-b"
			}
			rec.CreatedAt = base.Add(time.Duration(i) * time.Minute)
			require.NoError(t, tx.Insert(testDatastoreID, testCollection, rec))
		}
		return nil
	}))

	t.Run("default ordering is created_at desc with id tiebreak", func(t *testing.T) {
		recs, total, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 10,
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5), total)
		require.Len(t, recs, 5)
		assert.Equal(t, "dsr_fe", recs[0].ID, "newest first")
	})

	t.Run("pagination window with total", func(t *testing.T) {
		recs, total, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 2, Offset: 2,
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5), total)
		require.Len(t, recs, 2)
		assert.Equal(t, "dsr_fc", recs[0].ID)
	})

	t.Run("json field condition with integer comparison", func(t *testing.T) {
		recs, total, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 10,
			Conditions: []Condition{{Field: "seq", Op: datastorev1.RecordConditionOp_gte, Value: int64(3)}},
		})
		require.NoError(t, err)
		assert.Equal(t, int64(2), total)
		assert.Len(t, recs, 2)
	})

	t.Run("own scope composes as an unremovable conjunction", func(t *testing.T) {
		recs, total, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 10,
			OwnerKey: "owner-b",
		})
		require.NoError(t, err)
		assert.Equal(t, int64(2), total)
		for _, rec := range recs {
			assert.Equal(t, "owner-b", rec.CreatedByKey)
		}
	})

	t.Run("neq matches records where the field is absent", func(t *testing.T) {
		require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
			return tx.Insert(testDatastoreID, testCollection, testRecord("dsr_nostatus", "owner-a", map[string]any{
				"slot_start": "2026-07-22T04:30:00.000000000Z",
			}))
		}))
		_, total, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 10,
			Conditions: []Condition{{Field: "status", Op: datastorev1.RecordConditionOp_neq, Value: "cancelled"}},
		})
		require.NoError(t, err)
		assert.Equal(t, int64(6), total, "neq must include the record with no status value")
	})

	t.Run("order by declared field ascending", func(t *testing.T) {
		recs, _, err := s.Find(ctx, FindQuery{
			DatastoreID: testDatastoreID, Collection: testCollection, Limit: 10,
			Conditions: []Condition{{Field: "seq", Op: datastorev1.RecordConditionOp_not_null}},
			OrderBy:    &OrderBy{Field: "seq"},
		})
		require.NoError(t, err)
		require.Len(t, recs, 5)
		assert.Equal(t, "dsr_fa", recs[0].ID)
	})
}

func TestRecordRoundTrip_AttributionAndIntegerFidelity(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	// A value beyond float64's exact-integer range (2^53) must survive.
	big := int64(1<<53 + 17)
	rec := testRecord("dsr_round", "channel/whatsapp_phone/9198", map[string]any{"seq": big})
	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		return tx.Insert(testDatastoreID, testCollection, rec)
	}))

	got, err := s.Get(ctx, testDatastoreID, testCollection, "dsr_round")
	require.NoError(t, err)
	require.NotNil(t, got)

	sender := got.CreatedBy.GetChannelSender()
	require.NotNil(t, sender, "attribution subject must round-trip through proto marshaling")
	assert.Equal(t, "channel/whatsapp_phone/9198", got.CreatedByKey)

	n, ok := got.Fields["seq"].(interface{ Int64() (int64, error) })
	require.True(t, ok, "integers must come back as json.Number, got %T", got.Fields["seq"])
	i, err := n.Int64()
	require.NoError(t, err)
	assert.Equal(t, big, i, "integer fidelity beyond 2^53")
}

func TestGet_AbsentRecordReturnsNil(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)

	got, err := s.Get(context.Background(), testDatastoreID, testCollection, "dsr_missing")
	require.NoError(t, err)
	assert.Nil(t, got)
}

func TestUpdate_MissingRecordFails(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)

	err := s.WithWriteTx(context.Background(), func(tx Tx) error {
		return tx.Update(testDatastoreID, testCollection, testRecord("dsr_ghost", "o", map[string]any{"x": "y"}))
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestListCollectionTables_AndDrop(t *testing.T) {
	s := newTestStore(t)
	ctx := context.Background()

	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		for _, coll := range []string{"bookings", "schedules"} {
			if _, err := tx.EnsureCollectionTable(testDatastoreID, coll); err != nil {
				return err
			}
		}
		// A different datastore's table must not leak into the listing.
		_, err := tx.EnsureCollectionTable("dst_01hqother0000000000000000", "bookings")
		return err
	}))

	require.NoError(t, s.WithWriteTx(ctx, func(tx Tx) error {
		names, err := tx.ListCollectionTables(testDatastoreID)
		require.NoError(t, err)
		assert.ElementsMatch(t, []string{"bookings", "schedules"}, names)

		require.NoError(t, tx.DropCollectionTable(testDatastoreID, "schedules"))
		names, err = tx.ListCollectionTables(testDatastoreID)
		require.NoError(t, err)
		assert.Equal(t, []string{"bookings"}, names)
		return nil
	}))
}

// TestWithWriteTx_SerializesConcurrentWriters is the substrate half of
// the DD-007 concurrency requirement: BEGIN IMMEDIATE takes the write
// lock up front, so a second writer cannot interleave with a
// read-then-write transaction. (The domain half — schedule-close vs
// booking-insert through the exists constraint — is the controller
// concurrency test.)
func TestWithWriteTx_SerializesConcurrentWriters(t *testing.T) {
	s := newTestStore(t)
	mustEnsureTable(t, s)
	ctx := context.Background()

	const writers = 8
	var wg sync.WaitGroup
	inTx := make(chan struct{}, writers)
	errs := make([]error, writers)

	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = s.WithWriteTx(ctx, func(tx Tx) error {
				// Verify mutual exclusion: no other writer may be inside
				// its transaction while we are.
				select {
				case inTx <- struct{}{}:
				default:
					return errors.New("second writer entered a write transaction concurrently")
				}
				defer func() { <-inTx }()

				count, err := tx.CountRecords(testDatastoreID, testCollection)
				if err != nil {
					return err
				}
				time.Sleep(5 * time.Millisecond) // widen the race window
				return tx.Insert(testDatastoreID, testCollection, testRecord(
					// count is stable inside the lock, so ids stay unique
					"dsr_c"+string(rune('a'+i))+string(rune('0'+count)), "o", map[string]any{"seq": count},
				))
			})
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		require.NoError(t, err, "writer %d", i)
	}
	n, err := s.CountRecords(ctx, testDatastoreID, testCollection)
	require.NoError(t, err)
	assert.Equal(t, int64(writers), n)
}
