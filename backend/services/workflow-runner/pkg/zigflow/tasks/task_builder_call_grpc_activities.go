/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/stigmer/stigmer/backend/services/workflow-runner/graphs/contributors>
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

package tasks

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/fullstorydev/grpcurl"
	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallGRPCActivities{})
}

type CallGRPCActivities struct{}

func (c *CallGRPCActivities) CallGRPCActivity(
	ctx context.Context, task *model.CallGRPC, input any, runtimeEnv map[string]any,
) (any, error) {
	logger := activity.GetLogger(ctx)

	// **CRITICAL SECURITY**: Resolve runtime placeholders just-in-time (JIT)
	// Task has evaluated expressions, but still contains runtime placeholders like:
	//   - ${.secrets.API_KEY} → resolved to actual secret value
	//   - ${.env_vars.SERVICE_URL} → resolved to actual environment value
	//
	// This ensures secrets NEVER appear in Temporal workflow history.
	// Resolution happens here (in activity) where it won't be recorded in history.
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		logger.Debug("Resolving runtime placeholders in gRPC task", "env_count", len(runtimeEnv))
		
		// Resolve placeholders in the entire task structure
		resolvedInterface, err := ResolveObject(task, runtimeEnv)
		if err != nil {
			logger.Error("Failed to resolve runtime placeholders", "error", err)
			return nil, fmt.Errorf("failed to resolve runtime placeholders: %w", err)
		}
		
		// Convert back to CallGRPC type
		var ok bool
		task, ok = resolvedInterface.(*model.CallGRPC)
		if !ok {
			logger.Error("Type assertion failed after runtime resolution")
			return nil, fmt.Errorf("type assertion failed after runtime resolution")
		}
		
		logger.Debug("Runtime placeholders resolved successfully")
	}

	// Task now has fully resolved values (expressions + runtime placeholders)
	service := task.With.Service
	args := task.With.Arguments
	method := task.With.Method
	proto := task.With.Proto

	address := fmt.Sprintf("%s:%d", service.Host, service.Port)

	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		logger.Error("Error creating gRPC connection", "error", err)
		return nil, err
	}
	defer func() {
		err = conn.Close()
		if err != nil {
			logger.Error("Error closing body reader", "error", err)
		}
	}()

	u, err := url.Parse(proto.Endpoint.String())
	if err != nil {
		return nil, err
	}

	descriptorSource, err := grpcurl.DescriptorSourceFromProtoFiles([]string{"/"}, u.Path)
	if err != nil {
		logger.Error("Error loading proto file", "error", err, "file", u.Path)
		return nil, temporal.NewNonRetryableApplicationError("error loading protofile", "CallGRPC error", err)
	}

	jsonRequest, err := json.Marshal(args)
	if err != nil {
		logger.Error("Error converting arguments to JSON", "error", err)
		return nil, temporal.NewNonRetryableApplicationError("error converting arguments to json", "CallGRPC error", err)
	}

	options := grpcurl.FormatOptions{EmitJSONDefaultFields: true}
	jsonRequestReader := strings.NewReader(string(jsonRequest))
	rf, formatter, err := grpcurl.RequestParserAndFormatter(grpcurl.Format("json"), descriptorSource, jsonRequestReader, options)
	if err != nil {
		return nil, err
	}
	var resp bytes.Buffer
	eventHandler := &grpcurl.DefaultEventHandler{
		Out:            &resp,
		Formatter:      formatter,
		VerbosityLevel: 0,
	}

	methodFullName := fmt.Sprintf("%s/%s", service.Name, method)

	if err := grpcurl.InvokeRPC(
		ctx,
		descriptorSource,
		conn,
		methodFullName,
		[]string{},
		eventHandler,
		rf.Next,
	); err != nil {
		return nil, temporal.NewNonRetryableApplicationError("error loading protofile", "CallGRPC error", err)
	}

	var output map[string]any
	if err := json.Unmarshal(resp.Bytes(), &output); err != nil {
		logger.Warn("Cannot convert gRPC response to JSON - returning as string")
		
		// **SECURITY**: Sanitize string output for secret leakage
		stringOutput := resp.String()
		if runtimeEnv != nil && len(runtimeEnv) > 0 {
			warnings := SanitizeOutput(stringOutput, runtimeEnv)
			for _, warning := range warnings {
				logger.Warn("Potential secret leakage detected in gRPC response", "warning", warning)
			}
		}
		
		return stringOutput, err
	}

	// **SECURITY**: Sanitize JSON output for secret leakage
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		warnings := SanitizeOutput(output, runtimeEnv)
		for _, warning := range warnings {
			logger.Warn("Potential secret leakage detected in gRPC response", "warning", warning)
		}
	}

	logger.Debug("Returning gRPC response as JSON")
	return output, err
}
