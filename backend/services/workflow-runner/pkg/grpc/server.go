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

package grpc

import (
	"context"
	"fmt"
	"net"
	"sync"

	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/config"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/executor"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/grpc_client"
	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/types"
	"github.com/rs/zerolog/log"
	"go.temporal.io/sdk/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/emptypb"
)

// Server is the gRPC server for workflow runner command controller
type Server struct {
	runnerv1.UnimplementedWorkflowRunnerServiceControllerServer
	
	grpcServer      *grpc.Server
	healthServer    *health.Server
	stigmerConfig   *config.StigmerConfig
	temporalClient  client.Client  // Optional - nil in gRPC-only mode
	taskQueue       string          // Temporal task queue name
	
	// Track running executions for cancel/pause/resume
	executions     map[string]*ExecutionContext
	executionsMux  sync.RWMutex
}

// ExecutionContext holds context for a running workflow execution
type ExecutionContext struct {
	ExecutionID string
	Cancel      context.CancelFunc
	Status      string // running, paused, cancelled, completed, failed
	StatusMux   sync.RWMutex
}

// NewServer creates a new gRPC server for workflow runner
// temporalClient can be nil for gRPC-only mode
func NewServer(stigmerConfig *config.StigmerConfig, temporalClient client.Client, taskQueue string) *Server {
	return &Server{
		stigmerConfig:  stigmerConfig,
		temporalClient: temporalClient,
		taskQueue:      taskQueue,
		executions:     make(map[string]*ExecutionContext),
	}
}

// Start starts the gRPC server on the specified port
func (s *Server) Start(port int) error {
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
	if err != nil {
		return fmt.Errorf("failed to listen: %w", err)
	}

	// Create gRPC server with interceptors
	s.grpcServer = grpc.NewServer(
		grpc.MaxRecvMsgSize(10*1024*1024), // 10MB
		grpc.MaxSendMsgSize(10*1024*1024), // 10MB
	)

	// Register workflow runner command controller service
	runnerv1.RegisterWorkflowRunnerServiceControllerServer(s.grpcServer, s)

	// Register health service for Kubernetes health checks
	s.healthServer = health.NewServer()
	grpc_health_v1.RegisterHealthServer(s.grpcServer, s.healthServer)
	s.healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

	// Register reflection service for grpcurl/grpcui
	reflection.Register(s.grpcServer)

	log.Info().
		Int("port", port).
		Msg("Workflow Runner gRPC server is ready and listening")

	// Start serving (blocking)
	if err := s.grpcServer.Serve(lis); err != nil {
		return fmt.Errorf("failed to serve: %w", err)
	}

	return nil
}

// Stop gracefully stops the gRPC server
func (s *Server) Stop() {
	if s.grpcServer != nil {
		log.Info().Msg("Stopping workflow runner gRPC server")
		
		// Mark as not serving for health checks
		if s.healthServer != nil {
			s.healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_NOT_SERVING)
		}
		
		s.grpcServer.GracefulStop()
	}
}

// Execute implements synchronous workflow execution with streaming progress
// This is for testing and short-lived workflows (< 10 minutes)
// TODO(suresh): Removed from proto - will be replaced with Temporal-based solution
/* 
func (s *Server) Execute(input *runnerv1.WorkflowExecuteInput, stream runnerv1.WorkflowRunnerServiceController_ExecuteServer) error {
	workflowName := ""
	if input.Metadata != nil {
		workflowName = input.Metadata.Name
	}
	
	log.Info().
		Str("execution_id", input.WorkflowExecutionId).
		Str("workflow_name", workflowName).
		Msg("Execute: Starting synchronous workflow execution")

	// Create cancellable context
	ctx, cancel := context.WithCancel(stream.Context())
	defer cancel()

	// Track execution
	s.trackExecution(input.WorkflowExecutionId, cancel)
	defer s.untrackExecution(input.WorkflowExecutionId)

	// Create executor
	workflowExecutor := executor.NewWorkflowExecutor(s.callbackClient)

	// Create a channel to receive progress events
	progressChan := make(chan *runnerv1.WorkflowProgressEvent, 100)

	// Start execution in goroutine
	errChan := make(chan error, 1)
	go func() {
		// Execute workflow
		err := workflowExecutor.Execute(ctx, input)
		errChan <- err
		close(progressChan)
	}()

	// Stream progress events (for now, we'll send synthetic events)
	// In Phase 2+, the executor will send events via this channel
	for {
		select {
		case event, ok := <-progressChan:
			if !ok {
				// Channel closed, execution finished
				goto ExecutionComplete
			}
			// Send event to client
			if err := stream.Send(event); err != nil {
				log.Error().Err(err).Msg("Failed to send progress event")
				return status.Errorf(codes.Internal, "failed to send progress: %v", err)
			}

		case err := <-errChan:
			// Execution completed
			if err != nil {
				log.Error().
					Err(err).
					Str("execution_id", input.WorkflowExecutionId).
					Msg("Workflow execution failed")
				return status.Errorf(codes.Internal, "workflow execution failed: %v", err)
			}
			goto ExecutionComplete

		case <-ctx.Done():
			// Context cancelled (client disconnected or cancel requested)
			log.Warn().
				Str("execution_id", input.WorkflowExecutionId).
				Msg("Workflow execution cancelled")
			return status.Error(codes.Canceled, "execution cancelled")
		}
	}

ExecutionComplete:
	log.Info().
		Str("execution_id", input.WorkflowExecutionId).
		Msg("Synchronous workflow execution completed")
	return nil
}
*/

// ExecuteAsync implements asynchronous workflow execution
// Returns immediately with execution ID, workflow runs in background
func (s *Server) ExecuteAsync(ctx context.Context, input *runnerv1.WorkflowExecuteInput) (*runnerv1.WorkflowExecuteResponse, error) {
	log.Info().
		Str("execution_id", input.WorkflowExecutionId).
		Msg("ExecuteAsync: Starting workflow execution")

	// Check if Temporal client is available (DUAL/TEMPORAL mode)
	if s.temporalClient != nil {
		log.Info().
			Str("execution_id", input.WorkflowExecutionId).
			Str("task_queue", s.taskQueue).
			Msg("Starting Temporal workflow execution")
		
		// Prepare input for Temporal workflow (Phase 2+: Will query Stigmer service for metadata/env)
		workflowInput := &types.TemporalWorkflowInput{
			WorkflowExecutionID: input.WorkflowExecutionId,
			WorkflowYaml:        input.WorkflowYaml,
			Metadata:            nil,                  // Phase 2+: Query from Stigmer service
			EnvVars:             make(map[string]any), // Phase 2+: Query from Stigmer service
			InitialData:         nil,                  // Phase 2+: Query from Stigmer service
		}
		
		// Start Temporal workflow
		workflowOptions := client.StartWorkflowOptions{
			ID:        input.WorkflowExecutionId,
			TaskQueue: s.taskQueue,
		}
		
		workflowRun, err := s.temporalClient.ExecuteWorkflow(
			ctx,
			workflowOptions,
			executor.ExecuteServerlessWorkflow,
			workflowInput,
		)
		
		if err != nil {
			log.Error().
				Err(err).
				Str("execution_id", input.WorkflowExecutionId).
				Msg("Failed to start Temporal workflow")
			return nil, status.Errorf(codes.Internal, "failed to start Temporal workflow: %v", err)
		}
		
		log.Info().
			Str("execution_id", input.WorkflowExecutionId).
			Str("workflow_id", workflowRun.GetID()).
			Str("run_id", workflowRun.GetRunID()).
			Msg("✅ Temporal workflow started successfully")
		
		return &runnerv1.WorkflowExecuteResponse{
			WorkflowExecutionId: input.WorkflowExecutionId,
			Status:              "running",
			Message:             "Workflow execution started in Temporal",
		}, nil
	}
	
	// Fallback to direct execution (gRPC-only mode)
	log.Info().
		Str("execution_id", input.WorkflowExecutionId).
		Msg("No Temporal client available - using direct execution (gRPC-only mode)")
	
	// Create WorkflowExecutionClient for status updates
	executionClient, err := grpc_client.NewWorkflowExecutionClient(s.stigmerConfig)
	if err != nil {
		log.Error().Err(err).Msg("Failed to create execution client")
		return nil, status.Errorf(codes.Internal, "failed to create execution client: %v", err)
	}
	
	// Create cancellable context for background execution
	execCtx, cancel := context.WithCancel(context.Background())

	// Track execution
	s.trackExecution(input.WorkflowExecutionId, cancel)

	// Create executor with execution client
	workflowExecutor := executor.NewWorkflowExecutor(executionClient)

	// Start execution in background
	go func() {
		defer s.untrackExecution(input.WorkflowExecutionId)
		defer executionClient.Close()

		// Execute workflow
		err := workflowExecutor.Execute(execCtx, input)
		if err != nil {
			log.Error().
				Err(err).
				Str("execution_id", input.WorkflowExecutionId).
				Msg("Async workflow execution failed")
			// Error already reported via updateStatus RPC
		} else {
			log.Info().
				Str("execution_id", input.WorkflowExecutionId).
				Msg("Async workflow execution completed")
		}
	}()

	// Return immediately with execution ID
	response := &runnerv1.WorkflowExecuteResponse{
		WorkflowExecutionId: input.WorkflowExecutionId,
		Status:              "running",
		Message:             "Workflow execution started in background (gRPC-only mode)",
		// Note: subscribe_url and status_url would be set by Stigmer Service
	}

	return response, nil
}

// CancelExecution implements workflow cancellation
func (s *Server) CancelExecution(ctx context.Context, req *runnerv1.CancelExecutionRequest) (*emptypb.Empty, error) {
	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("reason", req.Reason).
		Bool("force", req.Force).
		Msg("CancelExecution: Cancelling workflow execution")

	// Get execution context
	execCtx := s.getExecution(req.ExecutionId)
	if execCtx == nil {
		log.Warn().
			Str("execution_id", req.ExecutionId).
			Msg("Execution not found or already completed")
		// Return success anyway (idempotent operation)
		return &emptypb.Empty{}, nil
	}

	// Update status
	execCtx.StatusMux.Lock()
	execCtx.Status = "cancelled"
	execCtx.StatusMux.Unlock()

	// Cancel the execution context
	if execCtx.Cancel != nil {
		execCtx.Cancel()
	}

	log.Info().
		Str("execution_id", req.ExecutionId).
		Msg("Workflow execution cancelled successfully")

	return &emptypb.Empty{}, nil
}

// PauseExecution implements workflow pause
func (s *Server) PauseExecution(ctx context.Context, req *runnerv1.PauseExecutionRequest) (*emptypb.Empty, error) {
	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("reason", req.Reason).
		Msg("PauseExecution: Pausing workflow execution")

	// Get execution context
	execCtx := s.getExecution(req.ExecutionId)
	if execCtx == nil {
		return nil, status.Errorf(codes.NotFound, "execution not found: %s", req.ExecutionId)
	}

	// Update status
	execCtx.StatusMux.Lock()
	if execCtx.Status != "running" {
		execCtx.StatusMux.Unlock()
		return nil, status.Errorf(codes.FailedPrecondition, "cannot pause execution in status: %s", execCtx.Status)
	}
	execCtx.Status = "paused"
	execCtx.StatusMux.Unlock()

	// TODO Phase 2+: Implement actual pause logic
	// For now, just update status
	log.Info().
		Str("execution_id", req.ExecutionId).
		Msg("Workflow execution paused (Phase 1.5: status only)")

	return &emptypb.Empty{}, nil
}

// ResumeExecution implements workflow resume
func (s *Server) ResumeExecution(ctx context.Context, req *runnerv1.ResumeExecutionRequest) (*emptypb.Empty, error) {
	log.Info().
		Str("execution_id", req.ExecutionId).
		Str("reason", req.Reason).
		Msg("ResumeExecution: Resuming workflow execution")

	// Get execution context
	execCtx := s.getExecution(req.ExecutionId)
	if execCtx == nil {
		return nil, status.Errorf(codes.NotFound, "execution not found: %s", req.ExecutionId)
	}

	// Update status
	execCtx.StatusMux.Lock()
	if execCtx.Status != "paused" {
		execCtx.StatusMux.Unlock()
		return nil, status.Errorf(codes.FailedPrecondition, "cannot resume execution in status: %s", execCtx.Status)
	}
	execCtx.Status = "running"
	execCtx.StatusMux.Unlock()

	// TODO Phase 2+: Implement actual resume logic
	// For now, just update status
	log.Info().
		Str("execution_id", req.ExecutionId).
		Msg("Workflow execution resumed (Phase 1.5: status only)")

	return &emptypb.Empty{}, nil
}

// trackExecution tracks a running execution
func (s *Server) trackExecution(executionID string, cancel context.CancelFunc) {
	s.executionsMux.Lock()
	defer s.executionsMux.Unlock()

	s.executions[executionID] = &ExecutionContext{
		ExecutionID: executionID,
		Cancel:      cancel,
		Status:      "running",
	}

	log.Debug().
		Str("execution_id", executionID).
		Int("total_executions", len(s.executions)).
		Msg("Tracking workflow execution")
}

// untrackExecution removes an execution from tracking
func (s *Server) untrackExecution(executionID string) {
	s.executionsMux.Lock()
	defer s.executionsMux.Unlock()

	delete(s.executions, executionID)

	log.Debug().
		Str("execution_id", executionID).
		Int("total_executions", len(s.executions)).
		Msg("Untracked workflow execution")
}

// getExecution gets an execution context
func (s *Server) getExecution(executionID string) *ExecutionContext {
	s.executionsMux.RLock()
	defer s.executionsMux.RUnlock()

	return s.executions[executionID]
}

// GetActiveExecutions returns the number of active executions
func (s *Server) GetActiveExecutions() int {
	s.executionsMux.RLock()
	defer s.executionsMux.RUnlock()

	return len(s.executions)
}
