package temporal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	schedulev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/schedule/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"go.temporal.io/sdk/client"
	"google.golang.org/protobuf/proto"
)

// probeIDPrefix marks the cloud write-path's throwaway fire-time probes.
// OSS never creates probes (no pre-persist probe — DD-015 D-A), but the
// prefix is skipped defensively so a shared/dev namespace never gets its
// probes treated as tick orphans.
const probeIDPrefix = "schedule/probe/"

// ReconcileCounts summarizes one convergence pass, for the log line.
type ReconcileCounts struct {
	RowsExamined   int
	Armed          int
	Repaired       int
	OrphansDeleted int
	Failures       int
}

func (c ReconcileCounts) String() string {
	return fmt.Sprintf("rows=%d armed=%d repaired=%d orphans_deleted=%d failures=%d",
		c.RowsExamined, c.Armed, c.Repaired, c.OrphansDeleted, c.Failures)
}

// Reconciler converges Schedule rows and Temporal artifacts in both
// directions: rows without artifacts get armed, drifted artifacts get
// rewritten, artifacts without rows get deleted.
//
// In cloud this pass is belt-and-braces behind a non-critical arming
// step. In OSS it is LOAD-BEARING (DD-015 D-B): `stigmer up` runs a
// managed Temporal DEV SERVER whose state is a local SQLite file — a
// restart, crash, or reset destroys every artifact, and without this
// pass every schedule would silently never fire again. That is also why
// StartReconciliation hooks the Temporal RECONNECT path, not just a
// timer: a reconnect is precisely the moment the artifacts are most
// likely to be gone.
type Reconciler struct {
	clientProvider func() client.Client
	store          store.Store
	syncer         *Syncer
	config         *Config
}

// NewReconciler wires the reconciler.
func NewReconciler(clientProvider func() client.Client, st store.Store, syncer *Syncer, config *Config) *Reconciler {
	return &Reconciler{clientProvider: clientProvider, store: st, syncer: syncer, config: config}
}

// artifactState is the describable slice the drift diff runs on. The
// baked ACTION is invisible to List — which is why the state note
// carries the cron+tz fingerprint (cron does not round-trip).
type artifactState struct {
	note   string
	paused bool
}

// RunPass executes one convergence pass. Per-row failures are counted
// and the pass continues — one broken schedule must never stop the rest
// from converging.
func (r *Reconciler) RunPass(ctx context.Context) ReconcileCounts {
	var counts ReconcileCounts

	temporalClient := r.clientProvider()
	if temporalClient == nil {
		log.Debug().Msg("Schedule reconciliation skipped — Temporal not connected")
		return counts
	}

	// Phase 1: snapshot every tick artifact in one listing.
	artifacts := map[string]artifactState{}
	iter, err := temporalClient.ScheduleClient().List(ctx, client.ScheduleListOptions{PageSize: 100})
	if err != nil {
		log.Error().Err(err).Msg("Schedule reconciliation could not list artifacts")
		counts.Failures++
		return counts
	}
	for iter.HasNext() {
		entry, iterErr := iter.Next()
		if iterErr != nil {
			log.Error().Err(iterErr).Msg("Schedule reconciliation listing failed mid-page")
			counts.Failures++
			return counts
		}
		switch {
		case strings.HasPrefix(entry.ID, TickIDPrefix):
			artifacts[ResourceIDOf(entry.ID)] = artifactState{note: entry.Note, paused: entry.Paused}
		case strings.HasPrefix(entry.ID, probeIDPrefix):
			// Not ours: OSS creates no probes (see probeIDPrefix).
		default:
			// Someone else's schedule (e.g. a user's own Temporal use on
			// the shared dev server) — never touch it.
		}
	}

	// Phase 2: walk every row; arm the unarmed, repair the drifted.
	// Removal from the map is what leaves the orphans behind for phase 3.
	rows, err := listSchedules(ctx, r.store)
	if err != nil {
		log.Error().Err(err).Msg("Schedule reconciliation could not list rows")
		counts.Failures++
		return counts
	}
	for _, row := range rows {
		counts.RowsExamined++
		resourceID := row.GetMetadata().GetId()
		actual, exists := artifacts[resourceID]
		delete(artifacts, resourceID)

		switch {
		case !exists:
			if _, err := r.syncer.EnsureAndRecord(ctx, row); err != nil {
				counts.Failures++
				log.Error().Err(err).Str("schedule_id", resourceID).
					Msg("Reconciliation failed to arm a schedule (pass continues)")
				continue
			}
			counts.Armed++
			log.Info().Str("schedule_id", resourceID).
				Msg("Reconciliation armed a schedule without an artifact")
		case actual.note != Note(row) || actual.paused != DesiredPaused(row):
			if _, err := r.syncer.EnsureAndRecord(ctx, row); err != nil {
				counts.Failures++
				log.Error().Err(err).Str("schedule_id", resourceID).
					Msg("Reconciliation failed to repair a drifted artifact (pass continues)")
				continue
			}
			counts.Repaired++
			log.Info().Str("schedule_id", resourceID).
				Str("actual_note", actual.note).Bool("actual_paused", actual.paused).
				Msg("Reconciliation repaired a drifted artifact")
		}
	}

	// Phase 3: reap orphans — but ONLY after a targeted point read
	// confirms the row is genuinely gone. A row created after phase 2's
	// listing must never lose its just-armed clock (THE guard, pinned by
	// test in both editions).
	for resourceID := range artifacts {
		fresh := &schedulev1.Schedule{}
		err := r.store.GetResource(ctx, apiresourcekind.ApiResourceKind_schedule, resourceID, fresh)
		if err == nil {
			continue // the row exists — not an orphan
		}
		if !errors.Is(err, store.ErrNotFound) {
			counts.Failures++
			log.Error().Err(err).Str("schedule_id", resourceID).
				Msg("Reconciliation could not confirm an orphan (leaving it; pass continues)")
			continue
		}
		if err := r.syncer.Teardown(ctx, resourceID); err != nil {
			counts.Failures++
			log.Error().Err(err).Str("schedule_id", resourceID).
				Msg("Reconciliation failed to delete an orphaned artifact (pass continues)")
			continue
		}
		counts.OrphansDeleted++
		log.Info().Str("schedule_id", resourceID).
			Msg("Reconciliation deleted an orphaned artifact")
	}

	// Phase 4: fire-ledger retention (DD-017 D-7) — the clock's one
	// periodic hook, so the ledger's bound needs no machinery of its own.
	pruneRunLedger(ctx, r.store, r.config.ResolvedRunHistoryRetentionDays())

	log.Info().Str("counts", counts.String()).Msg("Schedule reconciliation pass complete")
	return counts
}

// StartReconciliation runs the convergence loop: an immediate first pass
// (the boot is itself a "reconnect" — the dev server may have restarted
// while the daemon was down), then one pass per interval, plus
// out-of-band passes requested through the returned kick function (wired
// to the Temporal manager's reconnect hook).
//
// The env kill-switch disables only the PERIODIC passes; kicked passes
// still run — reconnect convergence is correctness, not hygiene.
func (r *Reconciler) StartReconciliation(ctx context.Context) (kick func()) {
	kicks := make(chan struct{}, 1)
	kick = func() {
		select {
		case kicks <- struct{}{}:
		default: // a pass is already queued — one is enough
		}
	}

	go func() {
		r.RunPass(ctx)

		var tickerC <-chan time.Time
		if r.config.ReconciliationEnabled {
			ticker := time.NewTicker(time.Duration(r.config.ReconciliationIntervalMinutes) * time.Minute)
			defer ticker.Stop()
			tickerC = ticker.C
		} else {
			log.Info().Msg("Periodic schedule reconciliation disabled " +
				"(STIGMER_SCHEDULES_RECONCILIATION_ENABLED=false) — reconnect passes still run")
		}

		for {
			select {
			case <-ctx.Done():
				return
			case <-tickerC:
				r.RunPass(ctx)
			case <-kicks:
				r.RunPass(ctx)
			}
		}
	}()
	return kick
}

// listSchedules loads every schedule row, skipping corrupt blobs (the
// lenient-read posture list endpoints use). OSS scale is a handful of
// schedules on one user's machine; the full listing per pass is noise
// (the cloud pass keysets because its table is a tenant population).
func listSchedules(ctx context.Context, st store.Store) ([]*schedulev1.Schedule, error) {
	blobs, err := st.ListResources(ctx, apiresourcekind.ApiResourceKind_schedule)
	if err != nil {
		return nil, err
	}
	schedules := make([]*schedulev1.Schedule, 0, len(blobs))
	for _, data := range blobs {
		schedule := &schedulev1.Schedule{}
		if unmarshalErr := proto.Unmarshal(data, schedule); unmarshalErr != nil {
			log.Warn().Err(unmarshalErr).Msg("Schedule reconciliation skipped a corrupt row")
			continue
		}
		schedules = append(schedules, schedule)
	}
	return schedules, nil
}
