// Copyright 2026 Stigmer Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package local

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/dgraph-io/badger/v4"

	pb "github.com/stigmer/stigmer/internal/gen/stigmer/backend/v1"
)

// Backend implements the Backend interface using BadgerDB
type Backend struct {
	db *badger.DB
}

// NewBackend creates a new local BadgerDB backend
func NewBackend(dbPath string) (*Backend, error) {
	// Ensure directory exists
	if err := os.MkdirAll(dbPath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// Open BadgerDB with default options
	opts := badger.DefaultOptions(dbPath).
		WithLogger(nil) // Disable BadgerDB logging for now

	db, err := badger.Open(opts)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	backend := &Backend{db: db}

	return backend, nil
}

// Close closes the database connection
func (b *Backend) Close() error {
	return b.db.Close()
}

// Execution methods (stubs for now)

func (b *Backend) CreateExecution(ctx context.Context, req *pb.CreateExecutionRequest) (*pb.Execution, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) GetExecution(ctx context.Context, req *pb.GetExecutionRequest) (*pb.Execution, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) UpdateExecutionStatus(ctx context.Context, req *pb.UpdateExecutionStatusRequest) (*pb.Execution, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) ListExecutions(ctx context.Context, req *pb.ListExecutionsRequest) (*pb.ListExecutionsResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) CancelExecution(ctx context.Context, req *pb.CancelExecutionRequest) (*pb.Execution, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) GetExecutionContext(ctx context.Context, req *pb.GetExecutionContextRequest) (*pb.ExecutionContext, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

// Agent methods (stubs)

func (b *Backend) GetAgent(ctx context.Context, req *pb.GetResourceRequest) (*pb.Agent, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) ListAgents(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListAgentsResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) UpdateAgent(ctx context.Context, req *pb.UpdateAgentRequest) (*pb.Agent, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) DeleteAgent(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

// Workflow methods (stubs)

func (b *Backend) GetWorkflow(ctx context.Context, req *pb.GetResourceRequest) (*pb.Workflow, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) ListWorkflows(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListWorkflowsResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) CreateWorkflow(ctx context.Context, req *pb.CreateWorkflowRequest) (*pb.Workflow, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) UpdateWorkflow(ctx context.Context, req *pb.UpdateWorkflowRequest) (*pb.Workflow, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) DeleteWorkflow(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

// Environment methods (stubs)

func (b *Backend) GetEnvironment(ctx context.Context, req *pb.GetResourceRequest) (*pb.Environment, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) CreateEnvironment(ctx context.Context, req *pb.CreateEnvironmentRequest) (*pb.Environment, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) UpdateEnvironment(ctx context.Context, req *pb.UpdateEnvironmentRequest) (*pb.Environment, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

// Artifact methods (stubs)

func (b *Backend) StoreArtifact(ctx context.Context, req *pb.StoreArtifactRequest) (*pb.StoreArtifactResponse, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}

func (b *Backend) GetArtifact(ctx context.Context, req *pb.GetArtifactRequest) (*pb.Artifact, error) {
	// TODO: Implement
	return nil, fmt.Errorf("not implemented yet")
}
