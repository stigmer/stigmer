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

package cloud

import (
	"context"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	pb "github.com/stigmer/stigmer/internal/gen/stigmer/backend/v1"
)

// Backend implements the Backend interface by proxying to Stigmer Cloud
type Backend struct {
	client pb.BackendServiceClient
	conn   *grpc.ClientConn
}

// NewBackend creates a new cloud backend client
func NewBackend(endpoint, token string) (*Backend, error) {
	// TODO: Add TLS credentials and authentication
	conn, err := grpc.Dial(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("failed to connect to Stigmer Cloud: %w", err)
	}

	client := pb.NewBackendServiceClient(conn)

	return &Backend{
		client: client,
		conn:   conn,
	}, nil
}

// Close closes the gRPC connection
func (b *Backend) Close() error {
	return b.conn.Close()
}

// All methods just proxy to the gRPC client

func (b *Backend) CreateExecution(ctx context.Context, req *pb.CreateExecutionRequest) (*pb.Execution, error) {
	return b.client.CreateExecution(ctx, req)
}

func (b *Backend) GetExecution(ctx context.Context, req *pb.GetExecutionRequest) (*pb.Execution, error) {
	return b.client.GetExecution(ctx, req)
}

func (b *Backend) UpdateExecutionStatus(ctx context.Context, req *pb.UpdateExecutionStatusRequest) (*pb.Execution, error) {
	return b.client.UpdateExecutionStatus(ctx, req)
}

func (b *Backend) ListExecutions(ctx context.Context, req *pb.ListExecutionsRequest) (*pb.ListExecutionsResponse, error) {
	return b.client.ListExecutions(ctx, req)
}

func (b *Backend) CancelExecution(ctx context.Context, req *pb.CancelExecutionRequest) (*pb.Execution, error) {
	return b.client.CancelExecution(ctx, req)
}

func (b *Backend) GetExecutionContext(ctx context.Context, req *pb.GetExecutionContextRequest) (*pb.ExecutionContext, error) {
	return b.client.GetExecutionContext(ctx, req)
}

func (b *Backend) GetAgent(ctx context.Context, req *pb.GetResourceRequest) (*pb.Agent, error) {
	return b.client.GetAgent(ctx, req)
}

func (b *Backend) ListAgents(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListAgentsResponse, error) {
	return b.client.ListAgents(ctx, req)
}

func (b *Backend) CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error) {
	return b.client.CreateAgent(ctx, req)
}

func (b *Backend) UpdateAgent(ctx context.Context, req *pb.UpdateAgentRequest) (*pb.Agent, error) {
	return b.client.UpdateAgent(ctx, req)
}

func (b *Backend) DeleteAgent(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error) {
	return b.client.DeleteAgent(ctx, req)
}

func (b *Backend) GetWorkflow(ctx context.Context, req *pb.GetResourceRequest) (*pb.Workflow, error) {
	return b.client.GetWorkflow(ctx, req)
}

func (b *Backend) ListWorkflows(ctx context.Context, req *pb.ListResourcesRequest) (*pb.ListWorkflowsResponse, error) {
	return b.client.ListWorkflows(ctx, req)
}

func (b *Backend) CreateWorkflow(ctx context.Context, req *pb.CreateWorkflowRequest) (*pb.Workflow, error) {
	return b.client.CreateWorkflow(ctx, req)
}

func (b *Backend) UpdateWorkflow(ctx context.Context, req *pb.UpdateWorkflowRequest) (*pb.Workflow, error) {
	return b.client.UpdateWorkflow(ctx, req)
}

func (b *Backend) DeleteWorkflow(ctx context.Context, req *pb.DeleteResourceRequest) (*pb.DeleteResourceResponse, error) {
	return b.client.DeleteWorkflow(ctx, req)
}

func (b *Backend) GetEnvironment(ctx context.Context, req *pb.GetResourceRequest) (*pb.Environment, error) {
	return b.client.GetEnvironment(ctx, req)
}

func (b *Backend) CreateEnvironment(ctx context.Context, req *pb.CreateEnvironmentRequest) (*pb.Environment, error) {
	return b.client.CreateEnvironment(ctx, req)
}

func (b *Backend) UpdateEnvironment(ctx context.Context, req *pb.UpdateEnvironmentRequest) (*pb.Environment, error) {
	return b.client.UpdateEnvironment(ctx, req)
}

func (b *Backend) StoreArtifact(ctx context.Context, req *pb.StoreArtifactRequest) (*pb.StoreArtifactResponse, error) {
	return b.client.StoreArtifact(ctx, req)
}

func (b *Backend) GetArtifact(ctx context.Context, req *pb.GetArtifactRequest) (*pb.Artifact, error) {
	return b.client.GetArtifact(ctx, req)
}
