package temporal

import (
	"github.com/rs/zerolog/log"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// WorkerConfig creates the schedule clock's Temporal worker.
//
// The tick runs on its own queue (schedule_stigmer): since a tick SPANS
// its run, a burst of long-tracking ticks must never starve the
// agent-execution queue's workers — and vice versa.
//
// The worker is created by the Temporal manager's createWorkers, which
// also RE-creates it on every reconnect. Components that merely call
// Temporal (the syncer, the reconciler) survive reconnects by reading
// the client through a provider; the worker is the one piece that must
// genuinely be rebuilt, because a worker is bound to the client it was
// created with.
type WorkerConfig struct {
	config     *Config
	activities *TickActivities
}

// NewWorkerConfig wires the worker configuration.
func NewWorkerConfig(config *Config, activities *TickActivities) *WorkerConfig {
	return &WorkerConfig{config: config, activities: activities}
}

// CreateWorker creates the worker and registers the tick workflow and
// its activities under their pinned names.
func (wc *WorkerConfig) CreateWorker(temporalClient client.Client) worker.Worker {
	w := worker.New(temporalClient, wc.config.StigmerQueue, worker.Options{})

	// CRITICAL: registered with the explicit cross-repo type name — the
	// artifact's baked action starts "schedule/tick", and without the
	// explicit name Temporal would register "Run" and every fire would
	// fail with "workflow type not found".
	w.RegisterWorkflowWithOptions(
		(&TickWorkflow{}).Run,
		workflow.RegisterOptions{Name: TickWorkflowType},
	)

	w.RegisterActivityWithOptions(wc.activities.RecordTick,
		activity.RegisterOptions{Name: RecordTickActivityName})
	w.RegisterActivityWithOptions(wc.activities.StartScheduledRun,
		activity.RegisterOptions{Name: StartScheduledRunActivityName})
	w.RegisterActivityWithOptions(wc.activities.PollExecutionPhase,
		activity.RegisterOptions{Name: PollExecutionPhaseActivityName})
	w.RegisterActivityWithOptions(wc.activities.RecordSuccessfulRun,
		activity.RegisterOptions{Name: RecordSuccessfulRunActivityName})
	w.RegisterActivityWithOptions(wc.activities.RecordFailedRun,
		activity.RegisterOptions{Name: RecordFailedRunActivityName})

	log.Info().Str("queue", wc.config.StigmerQueue).
		Msg("Registered schedule tick workflow and activities")
	return w
}
