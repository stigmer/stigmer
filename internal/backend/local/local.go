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
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite" // SQLite driver

	pb "github.com/stigmer/stigmer/internal/gen/stigmer/backend/v1"
)

// Backend implements the Backend interface using SQLite
type Backend struct {
	db *sql.DB
}

// NewBackend creates a new local SQLite backend
func NewBackend(dbPath string) (*Backend, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// Open SQLite database with WAL mode for concurrency
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_foreign_keys=1")
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	backend := &Backend{db: db}

	// Run migrations
	if err := backend.runMigrations(); err != nil {
		db.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return backend, nil
}

// runMigrations applies database migrations
func (b *Backend) runMigrations() error {
	// TODO: Implement proper migration system
	// For now, just check if schema exists
	var count int
	err := b.db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_version'").Scan(&count)
	if err != nil {
		return fmt.Errorf("failed to check schema: %w", err)
	}

	if count == 0 {
		// Schema doesn't exist, needs to be created
		// This would run the 001_initial_schema.sql migration
		return fmt.Errorf("database schema not initialized - run migrations manually for now")
	}

	return nil
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
