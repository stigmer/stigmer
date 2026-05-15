/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package worker

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/executor"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/heartbeat"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/interceptors"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/temporal/searchattributes"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/worker/activities"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/worker/config"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// ZigflowWorker represents a Temporal worker system.
//
// In sandbox mode (STIGMER_TASK_QUEUE set): two workers — orchestration + execution.
// In OSS/local mode: three workers — orchestration + execution + validation.
// The validation worker is only created when not in sandbox mode (a global K8s
// pod handles validation).
type ZigflowWorker struct {
	temporalClient client.Client
	config         *config.Config

	orchestrationWorker worker.Worker // {base}:wf-orch or workflow_execution_runner
	executionWorker     worker.Worker // {base}:wf-exec or zigflow_execution
	validationWorker    worker.Worker // workflow_validation_runner (nil in sandbox mode)

	claimCheckManager          *claimcheck.Manager
	executeWorkflowActivity    *activities.ExecuteWorkflowActivityImpl
	validateWorkflowActivities *activities.ValidateWorkflowActivities

	activityCounter *heartbeat.ActivityCounter
	heartbeatClient *heartbeat.Client
}

// NewZigflowWorker creates a new Temporal worker system with two-queue architecture.
func NewZigflowWorker(cfg *config.Config) (*ZigflowWorker, error) {
	// Create Temporal client
	temporalClient, err := client.Dial(client.Options{
		HostPort:  cfg.TemporalServiceAddress,
		Namespace: cfg.TemporalNamespace,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create Temporal client: %w", err)
	}

	log.Info().
		Str("address", cfg.TemporalServiceAddress).
		Str("namespace", cfg.TemporalNamespace).
		Msg("Connected to Temporal server")

	// Ensure required search attributes exist (like database migrations)
	// This is idempotent and safe to run on every startup
	ctx := context.Background()
	if err := searchattributes.EnsureSearchAttributesExist(ctx, temporalClient, cfg.TemporalNamespace); err != nil {
		log.Warn().Err(err).Msg("Failed to setup search attributes automatically - may need manual setup")
		log.Warn().Msg("See: _ops/setup-guides/06-temporal-search-attributes.md for manual setup instructions")
		// Don't fail startup - search attributes may already exist or permissions may be restricted
		// The failure will surface later when workflows try to use them
	}

	// Initialize Claim Check Manager if enabled
	var claimCheckMgr *claimcheck.Manager
	if cfg.ClaimCheckEnabled {
		log.Info().
			Int64("threshold_bytes", cfg.ClaimCheckThresholdBytes).
			Bool("compression_enabled", cfg.ClaimCheckCompressionEnabled).
			Str("r2_bucket", cfg.R2Bucket).
			Msg("Initializing Claim Check Manager")

		claimCheckCfg := claimcheck.Config{
			ThresholdBytes:     cfg.ClaimCheckThresholdBytes,
			TTLDays:            cfg.ClaimCheckTTLDays,
			CompressionEnabled: cfg.ClaimCheckCompressionEnabled,
			R2Bucket:           cfg.R2Bucket,
			R2Endpoint:         cfg.R2Endpoint,
			R2AccessKeyID:      cfg.R2AccessKeyID,
			R2SecretAccessKey:  cfg.R2SecretAccessKey,
			R2Region:           cfg.R2Region,
		}

		claimCheckMgr, err = claimcheck.NewManager(claimCheckCfg)
		if err != nil {
			return nil, fmt.Errorf("failed to initialize Claim Check Manager: %w", err)
		}

		// Test R2 connectivity
		ctx := context.Background()
		if err := claimCheckMgr.Health(ctx); err != nil {
			log.Warn().Err(err).Msg("Claim Check health check failed - R2 may not be accessible")
		} else {
			log.Info().Msg("Claim Check Manager initialized successfully - R2 connectivity verified")
		}

		claimcheck.SetGlobalManager(claimCheckMgr)
		log.Info().Msg("Claim Check Manager set as global singleton")
	} else {
		log.Info().Msg("Claim Check disabled - large payloads will use Temporal state directly")
	}

	// Initialize ExecuteWorkflowActivity (orchestration-level)
	executeWorkflowActivity, err := activities.NewExecuteWorkflowActivity(cfg.StigmerConfig, temporalClient, cfg.ExecutionTaskQueue)
	if err != nil {
		return nil, fmt.Errorf("failed to create ExecuteWorkflowActivity: %w", err)
	}
	log.Info().Msg("ExecuteWorkflowActivity initialized")

	// Initialize ValidateWorkflowActivities (only used in non-sandbox mode)
	var validateWorkflowActivities *activities.ValidateWorkflowActivities
	if !cfg.SandboxMode {
		validateWorkflowActivities = activities.NewValidateWorkflowActivities()
		log.Info().Msg("ValidateWorkflowActivities initialized (non-sandbox mode)")
	}

	activityCounter := heartbeat.NewActivityCounter()
	progressInterceptor := interceptors.NewProgressReportingInterceptor(cfg.StigmerConfig)
	counterInterceptor := heartbeat.NewActivityCounterInterceptor(activityCounter)

	orchestrationWorker := worker.New(temporalClient, cfg.OrchestrationTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
		Interceptors: []interceptor.WorkerInterceptor{
			counterInterceptor,
		},
	})
	log.Info().
		Str("task_queue", cfg.OrchestrationTaskQueue).
		Bool("sandbox_mode", cfg.SandboxMode).
		Msg("Created orchestration worker")

	executionWorker := worker.New(temporalClient, cfg.ExecutionTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
		Interceptors: []interceptor.WorkerInterceptor{
			progressInterceptor,
			counterInterceptor,
		},
	})
	log.Info().
		Str("task_queue", cfg.ExecutionTaskQueue).
		Msg("Created execution worker")

	var validationWorker worker.Worker
	if !cfg.SandboxMode && cfg.ValidationTaskQueue != "" {
		validationWorker = worker.New(temporalClient, cfg.ValidationTaskQueue, worker.Options{
			MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
		})
		log.Info().
			Str("task_queue", cfg.ValidationTaskQueue).
			Msg("Created validation worker (non-sandbox mode)")
	} else {
		log.Info().Msg("Validation worker skipped (sandbox mode — global K8s pod handles validation)")
	}

	hbClient := heartbeat.NewClient(cfg, activityCounter)

	return &ZigflowWorker{
		temporalClient:             temporalClient,
		config:                     cfg,
		orchestrationWorker:        orchestrationWorker,
		executionWorker:            executionWorker,
		validationWorker:           validationWorker,
		claimCheckManager:          claimCheckMgr,
		executeWorkflowActivity:    executeWorkflowActivity,
		validateWorkflowActivities: validateWorkflowActivities,
		activityCounter:            activityCounter,
		heartbeatClient:            hbClient,
	}, nil
}

// RegisterWorkflowsAndActivities registers workflows and activities on workers.
func (w *ZigflowWorker) RegisterWorkflowsAndActivities() {
	// Activity name must match Java @ActivityMethod annotation: "ExecuteWorkflow" (PascalCase)
	w.orchestrationWorker.RegisterActivityWithOptions(w.executeWorkflowActivity.ExecuteWorkflow, activity.RegisterOptions{
		Name: "ExecuteWorkflow",
	})
	log.Info().Str("queue", w.config.OrchestrationTaskQueue).Msg("Registered ExecuteWorkflow on orchestration queue")

	if w.validationWorker != nil && w.validateWorkflowActivities != nil {
		// Activity name must match Java interface method name: "validateWorkflow" (lowercase 'v')
		w.validationWorker.RegisterActivityWithOptions(w.validateWorkflowActivities.ValidateWorkflow, activity.RegisterOptions{
			Name: "validateWorkflow",
		})
		log.Info().Str("queue", w.config.ValidationTaskQueue).Msg("Registered validateWorkflow on validation queue")
	}

	w.executionWorker.RegisterWorkflowWithOptions(executor.ExecuteServerlessWorkflow, workflow.RegisterOptions{
		Name: "ExecuteServerlessWorkflow",
	})

	activityList := tasks.ActivitiesList()
	for _, act := range activityList {
		w.executionWorker.RegisterActivity(act)
	}
	log.Info().
		Str("queue", w.config.ExecutionTaskQueue).
		Int("activity_count", len(activityList)).
		Msg("Registered ExecuteServerlessWorkflow + Zigflow activities on execution queue")

	if w.claimCheckManager != nil {
		w.executionWorker.RegisterActivity(w.claimCheckManager.OffloadActivity)
		w.executionWorker.RegisterActivity(w.claimCheckManager.RetrieveActivity)
		log.Info().Msg("Registered Claim Check activities on execution queue")
	}

	log.Info().
		Bool("sandbox_mode", w.config.SandboxMode).
		Str("orchestration_queue", w.config.OrchestrationTaskQueue).
		Str("execution_queue", w.config.ExecutionTaskQueue).
		Str("validation_queue", w.config.ValidationTaskQueue).
		Msg("All workflows and activities registered")
}

// Start starts all Temporal workers and the heartbeat client (blocking call).
func (w *ZigflowWorker) Start() error {
	log.Info().Bool("sandbox_mode", w.config.SandboxMode).Msg("Starting Temporal worker system")

	w.heartbeatClient.Start()

	orchestrationErrCh := make(chan error, 1)
	go func() {
		if err := w.orchestrationWorker.Run(worker.InterruptCh()); err != nil {
			orchestrationErrCh <- fmt.Errorf("orchestration worker failed: %w", err)
		}
	}()

	executionErrCh := make(chan error, 1)
	go func() {
		if err := w.executionWorker.Run(worker.InterruptCh()); err != nil {
			executionErrCh <- fmt.Errorf("execution worker failed: %w", err)
		}
	}()

	if w.validationWorker != nil {
		validationErrCh := make(chan error, 1)
		go func() {
			if err := w.validationWorker.Run(worker.InterruptCh()); err != nil {
				validationErrCh <- fmt.Errorf("validation worker failed: %w", err)
			}
		}()

		log.Info().Msg("All workers started (orchestration + execution + validation)")
		select {
		case err := <-orchestrationErrCh:
			return err
		case err := <-executionErrCh:
			return err
		case err := <-validationErrCh:
			return err
		}
	}

	log.Info().Msg("All workers started (orchestration + execution, sandbox mode)")
	select {
	case err := <-orchestrationErrCh:
		return err
	case err := <-executionErrCh:
		return err
	}
}

// Stop gracefully stops the heartbeat client and all workers.
func (w *ZigflowWorker) Stop() {
	log.Info().Msg("Stopping Temporal worker system...")

	w.heartbeatClient.Stop()

	w.orchestrationWorker.Stop()
	w.executionWorker.Stop()
	if w.validationWorker != nil {
		w.validationWorker.Stop()
	}

	if w.executeWorkflowActivity != nil {
		if err := w.executeWorkflowActivity.Close(); err != nil {
			log.Warn().Err(err).Msg("Failed to close ExecuteWorkflowActivity")
		}
	}

	w.temporalClient.Close()
	log.Info().Msg("Temporal worker system stopped")
}

// GetTemporalClient returns the Temporal client for workflow execution.
func (w *ZigflowWorker) GetTemporalClient() client.Client {
	return w.temporalClient
}

// GetOrchestrationTaskQueue returns the orchestration task queue name.
func (w *ZigflowWorker) GetOrchestrationTaskQueue() string {
	return w.config.OrchestrationTaskQueue
}

// GetExecutionTaskQueue returns the execution task queue name.
func (w *ZigflowWorker) GetExecutionTaskQueue() string {
	return w.config.ExecutionTaskQueue
}

// GetClaimCheckManager returns the Claim Check Manager (nil if disabled).
func (w *ZigflowWorker) GetClaimCheckManager() *claimcheck.Manager {
	return w.claimCheckManager
}
