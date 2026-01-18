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

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/executor"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/interceptors"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/temporal/searchattributes"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/zigflow/tasks"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/worker/activities"
	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/worker/config"
	"github.com/rs/zerolog/log"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/interceptor"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
)

// ZigflowWorker represents a Temporal worker system with three-queue architecture:
// 1. Orchestration Queue: Handles ExecuteWorkflowActivity (workflow execution orchestration)
// 2. Execution Queue: Handles ExecuteServerlessWorkflow + Zigflow activities (user workflows)
// 3. Validation Queue: Handles validation activities (workflow validation)
type ZigflowWorker struct {
	temporalClient client.Client
	config         *config.Config

	// Three separate workers for clean separation
	orchestrationWorker worker.Worker // Queue: workflow_execution_runner
	executionWorker     worker.Worker // Queue: zigflow_execution
	validationWorker    worker.Worker // Queue: workflow_validation_runner

	// Shared resources
	claimCheckManager          *claimcheck.Manager
	executeWorkflowActivity    *activities.ExecuteWorkflowActivityImpl
	validateWorkflowActivities *activities.ValidateWorkflowActivities
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

	// Initialize ValidateWorkflowActivities (for workflow creation)
	validateWorkflowActivities := activities.NewValidateWorkflowActivities()
	log.Info().Msg("ValidateWorkflowActivities initialized")

	// Create progress reporting interceptor
	progressInterceptor := interceptors.NewProgressReportingInterceptor(cfg.StigmerConfig)

	// Create Worker 1: Orchestration Queue (workflow_execution)
	// Handles: ExecuteWorkflowActivity (Java → Go polyglot activity)
	orchestrationWorker := worker.New(temporalClient, cfg.OrchestrationTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
	})

	log.Info().
		Str("task_queue", cfg.OrchestrationTaskQueue).
		Msg("Created orchestration worker (for ExecuteWorkflowActivity)")

	// Create Worker 2: Execution Queue (zigflow_execution)
	// Handles: ExecuteServerlessWorkflow + all Zigflow activities
	executionWorker := worker.New(temporalClient, cfg.ExecutionTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
		Interceptors: []interceptor.WorkerInterceptor{
			progressInterceptor, // Automatic progress reporting for Zigflow activities
		},
	})

	log.Info().
		Str("task_queue", cfg.ExecutionTaskQueue).
		Msg("Created execution worker (for user workflows)")

	// Create Worker 3: Validation Queue (workflow_validation_runner)
	// Handles: GenerateYAMLActivity, ValidateStructureActivity (called by Java validation workflows)
	validationWorker := worker.New(temporalClient, cfg.ValidationTaskQueue, worker.Options{
		MaxConcurrentActivityExecutionSize: cfg.MaxConcurrency,
	})

	log.Info().
		Str("task_queue", cfg.ValidationTaskQueue).
		Msg("Created validation worker (for validation activities)")

	return &ZigflowWorker{
		temporalClient:             temporalClient,
		config:                     cfg,
		orchestrationWorker:        orchestrationWorker,
		executionWorker:            executionWorker,
		validationWorker:           validationWorker,
		claimCheckManager:          claimCheckMgr,
		executeWorkflowActivity:    executeWorkflowActivity,
		validateWorkflowActivities: validateWorkflowActivities,
	}, nil
}

// RegisterWorkflowsAndActivities registers workflows and activities on all three workers.
func (w *ZigflowWorker) RegisterWorkflowsAndActivities() {
	log.Info().Msg("Registering workflows and activities on three-queue architecture")

	// ========================================
	// ORCHESTRATION WORKER (workflow_execution_runner queue)
	// ========================================
	log.Info().Str("queue", w.config.OrchestrationTaskQueue).Msg("Configuring orchestration worker")

	// Register ExecuteWorkflowActivity (polyglot activity called from Java)
	// IMPORTANT: Activity name must match Java interface method name: "executeWorkflow" (lowercase 'e')
	// Java: WorkflowExecutionStatus executeWorkflow(WorkflowExecution execution);
	// Go method is ExecuteWorkflow (uppercase), but we register it as "executeWorkflow" (lowercase)
	w.orchestrationWorker.RegisterActivityWithOptions(w.executeWorkflowActivity.ExecuteWorkflow, activity.RegisterOptions{
		Name: "executeWorkflow", // Match Java interface method name (lowercase 'e')
	})
	log.Info().Msg("✅ Registered ExecuteWorkflowActivity as 'executeWorkflow' on orchestration queue")

	// ========================================
	// VALIDATION WORKER (workflow_validation_runner queue)
	// ========================================
	log.Info().Str("queue", w.config.ValidationTaskQueue).Msg("Configuring validation worker")

	// Register validation activity (called by Java ValidateWorkflowWorkflow)
	// Note: Workflow is in Java, activity is in Go (polyglot pattern)
	// Activity name must match Java interface method name: "validateWorkflow" (lowercase 'v')
	// Java: ServerlessWorkflowValidation validateWorkflow(WorkflowSpec spec);
	// Go method is ValidateWorkflow (uppercase), but we register it as "validateWorkflow" (lowercase)
	w.validationWorker.RegisterActivityWithOptions(w.validateWorkflowActivities.ValidateWorkflow, activity.RegisterOptions{
		Name: "validateWorkflow", // Match Java interface method name (lowercase 'v')
	})
	log.Info().Msg("✅ Registered ValidateWorkflow activity as 'validateWorkflow' on validation queue")

	// ========================================
	// EXECUTION WORKER (zigflow_execution queue)
	// ========================================
	log.Info().Str("queue", w.config.ExecutionTaskQueue).Msg("Configuring execution worker")

	// Register ExecuteServerlessWorkflow (the generic workflow that runs user workflows)
	w.executionWorker.RegisterWorkflowWithOptions(executor.ExecuteServerlessWorkflow, workflow.RegisterOptions{
		Name: "ExecuteServerlessWorkflow", // User-facing workflow
	})
	log.Info().Msg("✅ Registered ExecuteServerlessWorkflow on execution queue")

	// Register all Zigflow activities (CallHTTP, CallGRPC, etc.)
	activityList := tasks.ActivitiesList()
	log.Info().Int("activity_count", len(activityList)).Msg("Registering Zigflow activities")
	for _, activity := range activityList {
		w.executionWorker.RegisterActivity(activity)
	}
	log.Info().Msg("✅ Registered Zigflow activities on execution queue")

	// Register Claim Check activities if enabled
	if w.claimCheckManager != nil {
		w.executionWorker.RegisterActivity(w.claimCheckManager.OffloadActivity)
		w.executionWorker.RegisterActivity(w.claimCheckManager.RetrieveActivity)
		log.Info().Msg("✅ Registered Claim Check activities on execution queue")
	}

	log.Info().Msg("🎉 All workflows and activities registered successfully")
	log.Info().Msg("Architecture: Three-queue separation")
	log.Info().Msgf("  - %s: Orchestration (ExecuteWorkflowActivity)", w.config.OrchestrationTaskQueue)
	log.Info().Msgf("  - %s: Execution (User workflows + Zigflow tasks)", w.config.ExecutionTaskQueue)
	log.Info().Msgf("  - %s: Validation (GenerateYAML, ValidateStructure)", w.config.ValidationTaskQueue)
}

// Start starts all three Temporal workers (blocking call).
func (w *ZigflowWorker) Start() error {
	log.Info().Msg("Starting Temporal worker system")

	// Start orchestration worker in background
	orchestrationErrCh := make(chan error, 1)
	go func() {
		log.Info().Str("queue", w.config.OrchestrationTaskQueue).Msg("Starting orchestration worker")
		if err := w.orchestrationWorker.Run(worker.InterruptCh()); err != nil {
			orchestrationErrCh <- fmt.Errorf("orchestration worker failed: %w", err)
		}
	}()

	// Start execution worker in background
	executionErrCh := make(chan error, 1)
	go func() {
		log.Info().Str("queue", w.config.ExecutionTaskQueue).Msg("Starting execution worker")
		if err := w.executionWorker.Run(worker.InterruptCh()); err != nil {
			executionErrCh <- fmt.Errorf("execution worker failed: %w", err)
		}
	}()

	// Start validation worker in background
	validationErrCh := make(chan error, 1)
	go func() {
		log.Info().Str("queue", w.config.ValidationTaskQueue).Msg("Starting validation worker")
		if err := w.validationWorker.Run(worker.InterruptCh()); err != nil {
			validationErrCh <- fmt.Errorf("validation worker failed: %w", err)
		}
	}()

	log.Info().Msg("✅ All three workers started successfully")

	// Wait for any worker to fail or interrupt
	select {
	case err := <-orchestrationErrCh:
		return err
	case err := <-executionErrCh:
		return err
	case err := <-validationErrCh:
		return err
	}
}

// Stop gracefully stops all three workers.
func (w *ZigflowWorker) Stop() {
	log.Info().Msg("Stopping Temporal worker system...")

	// Stop all three workers
	w.orchestrationWorker.Stop()
	log.Info().Str("queue", w.config.OrchestrationTaskQueue).Msg("Orchestration worker stopped")

	w.executionWorker.Stop()
	log.Info().Str("queue", w.config.ExecutionTaskQueue).Msg("Execution worker stopped")

	w.validationWorker.Stop()
	log.Info().Str("queue", w.config.ValidationTaskQueue).Msg("Validation worker stopped")

	// Close ExecuteWorkflowActivity
	if w.executeWorkflowActivity != nil {
		if err := w.executeWorkflowActivity.Close(); err != nil {
			log.Warn().Err(err).Msg("Failed to close ExecuteWorkflowActivity")
		}
	}

	// Close Temporal client
	w.temporalClient.Close()
	log.Info().Msg("✅ Temporal worker system stopped")
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
