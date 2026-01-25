package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	agentexecutionactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities"
	workflowexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal"
	workflowexecutionactivities "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/activities"
	workflowexecutionworkflows "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows"
	workflowtemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/config"
	"go.temporal.io/sdk/client"
	temporallog "go.temporal.io/sdk/log"
	"go.temporal.io/sdk/worker"
)

// TemporalManager manages the Temporal connection lifecycle with automatic reconnection
// and worker management. It uses atomic operations for thread-safe client access and
// a separate mutex for connection/worker management operations.
type TemporalManager struct {
	// Atomic storage for the Temporal client (lock-free reads)
	temporalClient atomic.Value // stores client.Client or nil

	// Worker management
	workersMu sync.Mutex
	workers   []worker.Worker

	// Reconnection state
	reconnectMu      sync.Mutex
	lastAttempt      time.Time
	consecutiveFails int
	connected        bool

	// Configuration
	cfg       *config.Config
	namespace string

	// Server dependencies (for worker creation and workflow creator injection)
	serverDeps *serverDependencies
}

// serverDependencies holds references to server components needed for reconnection
type serverDependencies struct {
	store                        interface{} // store.Store
	agentExecutionController     interface{} // *agentexecutioncontroller.AgentExecutionController
	workflowExecutionController  interface{} // *workflowexecutioncontroller.WorkflowExecutionController
	workflowController           interface{} // *workflowcontroller.WorkflowController
	agentExecutionStreamBroker   interface{} // *agentexecution.StreamBroker
	workflowExecutionStreamBroker interface{} // *workflowexecution.StreamBroker
}

// NewTemporalManager creates a new Temporal connection manager
func NewTemporalManager(cfg *config.Config) *TemporalManager {
	return &TemporalManager{
		cfg:       cfg,
		namespace: cfg.TemporalNamespace,
		serverDeps: &serverDependencies{},
	}
}

// SetDependencies sets the server dependencies needed for worker creation
// This is called after controllers are created but before starting the health monitor
func (tm *TemporalManager) SetDependencies(
	store interface{},
	agentExecutionController interface{},
	workflowExecutionController interface{},
	workflowController interface{},
	agentExecutionStreamBroker interface{},
	workflowExecutionStreamBroker interface{},
) {
	tm.serverDeps.store = store
	tm.serverDeps.agentExecutionController = agentExecutionController
	tm.serverDeps.workflowExecutionController = workflowExecutionController
	tm.serverDeps.workflowController = workflowController
	tm.serverDeps.agentExecutionStreamBroker = agentExecutionStreamBroker
	tm.serverDeps.workflowExecutionStreamBroker = workflowExecutionStreamBroker
}

// GetClient returns the current Temporal client (may be nil)
// This is lock-free and safe for concurrent access
func (tm *TemporalManager) GetClient() client.Client {
	val := tm.temporalClient.Load()
	if val == nil {
		return nil
	}
	return val.(client.Client)
}

// IsConnected returns true if Temporal is currently connected
func (tm *TemporalManager) IsConnected() bool {
	tm.reconnectMu.Lock()
	defer tm.reconnectMu.Unlock()
	return tm.connected
}

// InitialConnect attempts the initial connection to Temporal with retries
// Returns the client if successful, nil if failed after all retries (non-fatal)
func (tm *TemporalManager) InitialConnect(ctx context.Context) client.Client {
	maxRetries := 3
	baseDelay := 1 * time.Second

	log.Info().
		Str("host_port", tm.cfg.TemporalHostPort).
		Str("namespace", tm.namespace).
		Int("max_retries", maxRetries).
		Msg("Attempting initial Temporal connection with retry")

	for attempt := 1; attempt <= maxRetries; attempt++ {
		// Try to connect
		temporalClient, err := tm.dialTemporal(ctx)
		if err == nil {
			// Success!
			tm.temporalClient.Store(temporalClient)
			tm.reconnectMu.Lock()
			tm.connected = true
			tm.consecutiveFails = 0
			tm.reconnectMu.Unlock()

			log.Info().
				Str("host_port", tm.cfg.TemporalHostPort).
				Str("namespace", tm.namespace).
				Int("attempt", attempt).
				Msg("✅ Initial Temporal connection successful")

			return temporalClient
		}

		// Connection failed
		if attempt < maxRetries {
			// Calculate exponential backoff: 1s, 2s, 4s, 8s, 16s
			delay := time.Duration(1<<uint(attempt-1)) * baseDelay
			log.Warn().
				Err(err).
				Str("host_port", tm.cfg.TemporalHostPort).
				Str("namespace", tm.namespace).
				Int("attempt", attempt).
				Int("max_retries", maxRetries).
				Dur("retry_in", delay).
				Msg("Temporal connection failed, retrying...")

			// Wait before retry
			select {
			case <-time.After(delay):
				// Continue to next attempt
			case <-ctx.Done():
				// Context cancelled
				log.Warn().Msg("Context cancelled during Temporal connection retry")
				tm.reconnectMu.Lock()
				tm.connected = false
				tm.consecutiveFails = attempt
				tm.lastAttempt = time.Now()
				tm.reconnectMu.Unlock()
				return nil
			}
		} else {
			// Final attempt failed
			log.Warn().
				Err(err).
				Str("host_port", tm.cfg.TemporalHostPort).
				Str("namespace", tm.namespace).
				Int("attempts", maxRetries).
				Msg("Failed initial Temporal connection after all retries - will retry via health monitor")

			tm.reconnectMu.Lock()
			tm.connected = false
			tm.consecutiveFails = maxRetries
			tm.lastAttempt = time.Now()
			tm.reconnectMu.Unlock()
		}
	}

	return nil
}

// StartHealthMonitor starts the background health check and reconnection goroutine
func (tm *TemporalManager) StartHealthMonitor(ctx context.Context) {
	log.Info().Msg("Starting Temporal health monitor")

	// Immediate check on start
	go tm.checkAndReconnect(ctx)

	// Periodic checks every 15 seconds
	ticker := time.NewTicker(15 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("Temporal health monitor stopped")
				return
			case <-ticker.C:
				tm.checkAndReconnect(ctx)
			}
		}
	}()
}

// checkAndReconnect checks the connection health and reconnects if needed
func (tm *TemporalManager) checkAndReconnect(ctx context.Context) {
	// Check if we need to reconnect
	currentClient := tm.GetClient()
	
	if currentClient != nil {
		// Test existing connection
		if tm.testConnection(ctx, currentClient) {
			// Connection is healthy
			if !tm.IsConnected() {
				// Update state to connected
				tm.reconnectMu.Lock()
				tm.connected = true
				tm.consecutiveFails = 0
				tm.reconnectMu.Unlock()
			}
			return
		}
		
		// Connection is unhealthy
		log.Warn().Msg("Temporal connection unhealthy, initiating reconnection")
	}

	// Attempt reconnection
	tm.attemptReconnection(ctx)
}

// testConnection tests if the current connection is healthy
func (tm *TemporalManager) testConnection(ctx context.Context, c client.Client) bool {
	testCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	// Use CheckHealth as a lightweight health check
	_, err := c.CheckHealth(testCtx, nil)
	return err == nil
}

// attemptReconnection attempts to reconnect to Temporal with exponential backoff
func (tm *TemporalManager) attemptReconnection(ctx context.Context) {
	// Only one reconnection attempt at a time
	if !tm.reconnectMu.TryLock() {
		return // Another goroutine is already reconnecting
	}
	defer tm.reconnectMu.Unlock()

	// Check backoff
	backoff := tm.calculateBackoff()
	if time.Since(tm.lastAttempt) < backoff {
		return // Too soon to retry
	}

	tm.lastAttempt = time.Now()

	log.Info().
		Int("attempt", tm.consecutiveFails+1).
		Dur("backoff", backoff).
		Msg("Attempting Temporal reconnection")

	// Dial new client
	newClient, err := tm.dialTemporal(ctx)
	if err != nil {
		tm.consecutiveFails++
		tm.connected = false
		
		log.Warn().
			Err(err).
			Int("consecutive_failures", tm.consecutiveFails).
			Msg("Temporal reconnection failed, will retry")
		return
	}

	// Success - swap the client
	oldClient := tm.GetClient()
	tm.temporalClient.Store(newClient)
	tm.consecutiveFails = 0
	tm.connected = true

	log.Info().Msg("✅ Temporal reconnected successfully")

	// Restart workers with new client
	tm.restartWorkers(newClient)

	// Reinject workflow creators into controllers
	tm.reinjectWorkflowCreators(newClient)

	// Clean up old client
	if oldClient != nil {
		log.Debug().Msg("Closing old Temporal client")
		oldClient.Close()
	}
}

// calculateBackoff calculates exponential backoff duration based on consecutive failures
func (tm *TemporalManager) calculateBackoff() time.Duration {
	if tm.consecutiveFails == 0 {
		return 0
	}

	// Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
	backoff := time.Duration(1<<uint(tm.consecutiveFails-1)) * time.Second
	if backoff > 30*time.Second {
		backoff = 30 * time.Second
	}
	return backoff
}

// dialTemporal creates a new Temporal client connection
func (tm *TemporalManager) dialTemporal(ctx context.Context) (client.Client, error) {
	return client.Dial(client.Options{
		HostPort:  tm.cfg.TemporalHostPort,
		Namespace: tm.namespace,
		Logger:    temporallog.NewStructuredLogger(slog.New(slog.NewTextHandler(io.Discard, nil))),
	})
}

// restartWorkers stops old workers and starts new ones with the new client
func (tm *TemporalManager) restartWorkers(newClient client.Client) {
	tm.workersMu.Lock()
	defer tm.workersMu.Unlock()

	log.Info().Int("worker_count", len(tm.workers)).Msg("Stopping old workers")

	// Stop all existing workers
	for i, w := range tm.workers {
		log.Debug().Int("worker_index", i).Msg("Stopping worker")
		w.Stop()
	}

	// Clear worker list
	tm.workers = nil

	log.Info().Msg("Creating and starting new workers")

	// Create new workers with the new client
	newWorkers := tm.createWorkers(newClient)
	
	// Start all new workers
	for i, w := range newWorkers {
		log.Debug().Int("worker_index", i).Msg("Starting worker")
		if err := w.Start(); err != nil {
			log.Error().
				Err(err).
				Int("worker_index", i).
				Msg("Failed to start worker")
			continue
		}
	}

	tm.workers = newWorkers
	log.Info().Int("worker_count", len(newWorkers)).Msg("✅ Workers restarted successfully")
}

// createWorkers creates all Temporal workers
func (tm *TemporalManager) createWorkers(temporalClient client.Client) []worker.Worker {
	var workers []worker.Worker

	// 1. Create workflow execution worker
	if tm.serverDeps.store != nil && tm.serverDeps.workflowExecutionStreamBroker != nil {
		// Type assert store and streamBroker
		storeVal, storeOk := tm.serverDeps.store.(store.Store)
		streamBroker, brokerOk := tm.serverDeps.workflowExecutionStreamBroker.(workflowexecutionactivities.StreamBroker)
		
		if storeOk && brokerOk {
			workflowExecutionTemporalConfig := workflowexecutiontemporal.LoadConfig()
			workerConfig := workflowexecutiontemporal.NewWorkerConfig(
				workflowExecutionTemporalConfig,
				storeVal,
				streamBroker,
			)
			workers = append(workers, workerConfig.CreateWorker(temporalClient))
			log.Debug().
				Str("stigmer_queue", workflowExecutionTemporalConfig.StigmerQueue).
				Str("runner_queue", workflowExecutionTemporalConfig.RunnerQueue).
				Msg("Created workflow execution worker")
		} else {
			log.Warn().Msg("Failed to type assert workflow execution dependencies")
		}
	}

	// 2. Create agent execution worker
	if tm.serverDeps.store != nil && tm.serverDeps.agentExecutionStreamBroker != nil {
		// Type assert store and streamBroker
		storeVal, storeOk := tm.serverDeps.store.(store.Store)
		streamBroker, brokerOk := tm.serverDeps.agentExecutionStreamBroker.(agentexecutionactivities.StreamBroker)
		
		if storeOk && brokerOk {
			agentExecutionTemporalConfig := agentexecutiontemporal.NewConfig()
			workerConfig := agentexecutiontemporal.NewWorkerConfig(
				agentExecutionTemporalConfig,
				storeVal,
				streamBroker,
			)
			workers = append(workers, workerConfig.CreateWorker(temporalClient))
			log.Debug().
				Str("stigmer_queue", agentExecutionTemporalConfig.StigmerQueue).
				Str("runner_queue", agentExecutionTemporalConfig.RunnerQueue).
				Msg("Created agent execution worker")
		} else {
			log.Warn().Msg("Failed to type assert agent execution dependencies")
		}
	}

	// 3. Create workflow validation worker
	workflowValidationTemporalConfig := workflowtemporal.NewConfig()
	workerConfig := workflowtemporal.NewWorkerConfig(workflowValidationTemporalConfig)
	workers = append(workers, workerConfig.CreateWorker(temporalClient))
	log.Debug().
		Str("stigmer_queue", workflowValidationTemporalConfig.StigmerQueue).
		Str("runner_queue", workflowValidationTemporalConfig.RunnerQueue).
		Msg("Created workflow validation worker")

	return workers
}

// StartWorkers starts all workers for the first time (called during server startup)
func (tm *TemporalManager) StartWorkers(temporalClient client.Client) error {
	tm.workersMu.Lock()
	defer tm.workersMu.Unlock()

	if temporalClient == nil {
		log.Warn().Msg("No Temporal client available, workers not started")
		return nil
	}

	log.Info().Msg("Starting Temporal workers")

	workers := tm.createWorkers(temporalClient)
	
	for i, w := range workers {
		if err := w.Start(); err != nil {
			return fmt.Errorf("failed to start worker %d: %w", i, err)
		}
		log.Debug().Int("worker_index", i).Msg("Worker started")
	}

	tm.workers = workers
	log.Info().Int("worker_count", len(workers)).Msg("All Temporal workers started")
	
	return nil
}

// StopWorkers stops all workers (called during server shutdown)
func (tm *TemporalManager) StopWorkers() {
	tm.workersMu.Lock()
	defer tm.workersMu.Unlock()

	log.Info().Int("worker_count", len(tm.workers)).Msg("Stopping all workers")

	for i, w := range tm.workers {
		log.Debug().Int("worker_index", i).Msg("Stopping worker")
		w.Stop()
	}

	tm.workers = nil
	log.Info().Msg("All workers stopped")
}

// reinjectWorkflowCreators creates new workflow creators and reinjects them into controllers
func (tm *TemporalManager) reinjectWorkflowCreators(temporalClient client.Client) {
	log.Info().Msg("Reinjecting workflow creators into controllers")

	// 1. Create and inject agent execution workflow creator
	if tm.serverDeps.agentExecutionController != nil {
		agentExecutionTemporalConfig := agentexecutiontemporal.NewConfig()
		agentExecutionWorkflowCreator := agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(
			temporalClient,
			agentExecutionTemporalConfig,
		)
		
		// Type assert to access SetWorkflowCreator method
		if controller, ok := tm.serverDeps.agentExecutionController.(interface {
			SetWorkflowCreator(*agentexecutiontemporal.InvokeAgentExecutionWorkflowCreator)
		}); ok {
			controller.SetWorkflowCreator(agentExecutionWorkflowCreator)
			log.Debug().Msg("Reinjected agent execution workflow creator")
		}
	}

	// 2. Create and inject workflow execution workflow creator
	if tm.serverDeps.workflowExecutionController != nil {
		workflowExecutionTemporalConfig := workflowexecutiontemporal.LoadConfig()
		workflowExecutionWorkflowCreator := workflowexecutionworkflows.NewInvokeWorkflowExecutionWorkflowCreator(
			temporalClient,
			workflowExecutionTemporalConfig.StigmerQueue,
			workflowExecutionTemporalConfig.RunnerQueue,
		)
		
		// Type assert to access SetWorkflowCreator method
		if controller, ok := tm.serverDeps.workflowExecutionController.(interface {
			SetWorkflowCreator(*workflowexecutionworkflows.InvokeWorkflowExecutionWorkflowCreator)
		}); ok {
			controller.SetWorkflowCreator(workflowExecutionWorkflowCreator)
			log.Debug().Msg("Reinjected workflow execution workflow creator")
		}
	}

	// 3. Create and inject workflow validator
	if tm.serverDeps.workflowController != nil {
		workflowValidationTemporalConfig := workflowtemporal.NewConfig()
		workflowValidator := workflowtemporal.NewServerlessWorkflowValidator(
			temporalClient,
			workflowValidationTemporalConfig,
		)
		
		// Type assert to access SetValidator method
		if controller, ok := tm.serverDeps.workflowController.(interface {
			SetValidator(*workflowtemporal.ServerlessWorkflowValidator)
		}); ok {
			controller.SetValidator(workflowValidator)
			log.Debug().Msg("Reinjected workflow validator")
		}
	}

	log.Info().Msg("✅ Workflow creators reinjected successfully")
}

// Close closes the Temporal connection and stops all workers
func (tm *TemporalManager) Close() {
	log.Info().Msg("Closing Temporal manager")

	// Stop all workers
	tm.StopWorkers()

	// Close client
	currentClient := tm.GetClient()
	if currentClient != nil {
		log.Debug().Msg("Closing Temporal client")
		currentClient.Close()
		// Note: No need to clear atomic.Value during shutdown
		// (storing nil in atomic.Value causes panic)
	}

	log.Info().Msg("Temporal manager closed")
}
