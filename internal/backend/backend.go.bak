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

package backend

import (
	"context"

	pb "github.com/stigmer/stigmer/internal/gen/stigmer/backend/v1"
)

// Backend defines the interface that all Stigmer backends must implement.
// This ensures feature parity between Local (BadgerDB) and Cloud (gRPC) backends.
//
// Implementations:
//   - Local: internal/backend/local - BadgerDB key-value storage
//   - Cloud: internal/backend/cloud - gRPC client to Stigmer Cloud
type Backend interface {
	// Execution lifecycle management
	CreateExecution(ctx context.Context, req *pb.CreateExecutionRequest) (*pb.Execution, error)
	GetExecution(ctx context.Context, req *pb.GetExecutionRequest) (*pb.Execution, error)
	UpdateExecutionStatus(ctx context.Context, req *pb.UpdateExecutionStatusRequest) (*pb.Execution, error)
	ListExecutions(ctx context.Context, req *pb.ListExecutionsRequest) (*pb.ListExecutionsResponse, error)
	CancelExecution(ctx context.Context, req *pb.CancelExecutionRequest) (*pb.Execution, error)

	// Just-In-Time execution context retrieval (includes decrypted secrets)
	GetExecutionContext(ctx context.Context, req *pb.GetExecutionContextRequest) (*pb.ExecutionContext, error)

	// Agent management
	GetAgent(ctx context.Context, req *pb.GetResourceRequest) (*pb.Agent, error)
	ListAgents(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListAgentsResponse, error)
	CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error)
	UpdateAgent(ctx context.Context, req *pb.UpdateAgentRequest) (*pb.Agent, error)
	DeleteAgent(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error)

	// Workflow management
	GetWorkflow(ctx context.Context, req *pb.GetResourceRequest) (*pb.Workflow, error)
	ListWorkflows(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListWorkflowsResponse, error)
	CreateWorkflow(ctx context.Context, req *pb.CreateWorkflowRequest) (*pb.Workflow, error)
	UpdateWorkflow(ctx context.Context, req *pb.UpdateWorkflowRequest) (*pb.Workflow, error)
	DeleteWorkflow(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error)

	// Environment and secrets
	GetEnvironment(ctx context.Context, req *pb.GetResourceRequest) (*pb.Environment, error)
	CreateEnvironment(ctx context.Context, req *pb.CreateEnvironmentRequest) (*pb.Environment, error)
	UpdateEnvironment(ctx context.Context, req *pb.UpdateEnvironmentRequest) (*pb.Environment, error)

	// Artifact storage
	StoreArtifact(ctx context.Context, req *pb.StoreArtifactRequest) (*pb.StoreArtifactResponse, error)
	GetArtifact(ctx context.Context, req *pb.GetArtifactRequest) (*pb.Artifact, error)

	// Lifecycle methods
	Close() error
}

// Config holds backend configuration
type Config struct {
	Type  string      // "local" or "cloud"
	Local *LocalConfig
	Cloud *CloudConfig
}

// LocalConfig holds BadgerDB backend configuration
type LocalConfig struct {
	DBPath string // Path to BadgerDB data directory
}

// CloudConfig holds cloud backend configuration
type CloudConfig struct {
	Endpoint string // gRPC endpoint (e.g., api.stigmer.io:443)
	Token    string // Authentication token
}
