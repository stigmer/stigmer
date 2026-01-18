/*
 * Copyright 2025 - 2026 Zigflow authors <https://github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/graphs/contributors>
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
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/serverlessworkflow/sdk-go/v3/model"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

func init() {
	activitiesRegistry = append(activitiesRegistry, &CallHTTPActivities{})
}

type CallHTTPActivities struct{}

func (c *CallHTTPActivities) CallHTTPActivity(ctx context.Context, task *model.CallHTTP, input any, runtimeEnv map[string]any) (any, error) {
	logger := activity.GetLogger(ctx)
	logger.Debug("Running call HTTP activity")

	info := activity.GetInfo(ctx)

	// **CRITICAL SECURITY**: Resolve runtime placeholders just-in-time (JIT)
	// Task has evaluated expressions, but still contains runtime placeholders like:
	//   - ${.secrets.API_KEY} → resolved to actual secret value
	//   - ${.env_vars.REGION} → resolved to actual environment value
	//
	// This ensures secrets NEVER appear in Temporal workflow history.
	// Resolution happens here (in activity) where it won't be recorded in history.
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		logger.Debug("Resolving runtime placeholders in HTTP task", "env_count", len(runtimeEnv))
		
		// Resolve placeholders in the entire task structure
		resolvedInterface, err := ResolveObject(task, runtimeEnv)
		if err != nil {
			logger.Error("Failed to resolve runtime placeholders", "error", err)
			return nil, fmt.Errorf("failed to resolve runtime placeholders: %w", err)
		}
		
		// Convert back to CallHTTP type
		var ok bool
		task, ok = resolvedInterface.(*model.CallHTTP)
		if !ok {
			logger.Error("Type assertion failed after runtime resolution")
			return nil, fmt.Errorf("type assertion failed after runtime resolution")
		}
		
		logger.Debug("Runtime placeholders resolved successfully")
	}

	// Task now has fully resolved values (expressions + runtime placeholders)
	resp, method, url, reqHeaders, err := c.callHTTPAction(ctx, task, info.StartToCloseTimeout)
	if err != nil {
		logger.Error("Error making HTTP call", "method", method, "url", url, "error", err)
		return nil, err
	}
	defer func() {
		err = resp.Body.Close()
		if err != nil {
			logger.Error("Error closing body reader", "error", err)
		}
	}()

	bodyRes, err := io.ReadAll(resp.Body)
	if err != nil {
		logger.Error("Error reading HTTP body", "method", method, "url", url, "error", err)
		return nil, err
	}

	// Try converting the body as JSON, returning as string if not possible
	var content any
	var bodyJSON map[string]any
	if err := json.Unmarshal(bodyRes, &bodyJSON); err != nil {
		// Log error
		logger.Debug("Error converting body to JSON", "error", err)
		content = string(bodyRes)
	} else {
		content = bodyJSON
	}

	// Treat redirects as an error - if you have "redirect = true", this will be ignored
	if resp.StatusCode >= 300 && resp.StatusCode < 400 {
		logger.Error("CallHTTP returned 3xx status", "statusCode", resp.StatusCode, "responseBody", content)
		return nil, temporal.NewNonRetryableApplicationError(
			"CallHTTP returned 3xx status code",
			"CallHTTP error",
			errors.New(resp.Status),
			content,
		)
	}

	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		// Client error - treat as non-retryable error as we need to fix it
		logger.Error("CallHTTP returned 4xx error", "statusCode", resp.StatusCode, "responseBody", content)
		return nil, temporal.NewNonRetryableApplicationError(
			"CallHTTP returned 4xx status code",
			"CallHTTP error",
			errors.New(resp.Status),
			content,
		)
	}

	if resp.StatusCode >= 500 && resp.StatusCode < 600 {
		// Server error - treat as retryable error as we can't fix it
		logger.Error("CallHTTP returned 5xx error", "statusCode", resp.StatusCode, "responseBody", content)
		return nil, temporal.NewApplicationError(
			"CallHTTP returned 5xx error",
			"CallHTTP error",
			errors.New(resp.Status),
			map[string]any{
				"statusCode": resp.StatusCode,
				"content":    content,
			},
		)
	}

	respHeader := map[string]string{}
	for k, v := range resp.Header {
		respHeader[k] = strings.Join(v, ", ")
	}

	httpResponse := HTTPResponse{
		Request: HTTPRequest{
			Method:  method,
			URI:     url,
			Headers: reqHeaders,
		},
		StatusCode: resp.StatusCode,
		Headers:    respHeader,
		Content:    content,
	}

	output := c.parseOutput(task.With.Output, httpResponse, bodyRes)
	
	// **SECURITY**: Sanitize output to detect accidental secret leakage
	// This is a defensive measure - ideally secrets should never appear in outputs,
	// but this provides a safety net by logging warnings if secret values are found.
	if runtimeEnv != nil && len(runtimeEnv) > 0 {
		warnings := SanitizeOutput(output, runtimeEnv)
		for _, warning := range warnings {
			logger.Warn("Potential secret leakage detected in HTTP response", "warning", warning)
		}
	}
	
	return output, err
}

func (c *CallHTTPActivities) callHTTPAction(ctx context.Context, task *model.CallHTTP, timeout time.Duration) (
	resp *http.Response,
	method, url string,
	reqHeaders map[string]string,
	err error,
) {
	logger := activity.GetLogger(ctx)

	// Task arguments are already evaluated in workflow context
	args := &task.With

	method = strings.ToUpper(args.Method)
	url = args.Endpoint.String()
	body := args.Body

	logger.Debug("Making HTTP call", "method", method, "url", url)
	req, err := http.NewRequestWithContext(ctx, method, url, bytes.NewBuffer(body))
	if err != nil {
		logger.Error("Error making HTTP request", "method", method, "url", url, "error", err)
		return resp, method, url, reqHeaders, err
	}

	// Add in headers
	reqHeaders = map[string]string{}
	for k, v := range args.Headers {
		req.Header.Add(k, v)
		reqHeaders[k] = v
	}

	// Add in query strings
	q := req.URL.Query()
	for k, v := range args.Query {
		q.Add(k, v.(string))
	}
	req.URL.RawQuery = q.Encode()

	client := &http.Client{
		Timeout: timeout,
	}

	if !args.Redirect {
		client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		}
	}

	resp, err = client.Do(req)
	if err != nil {
		return resp, method, url, reqHeaders, err
	}

	return resp, method, url, reqHeaders, err
}


func (c *CallHTTPActivities) parseOutput(outputType string, httpResp HTTPResponse, raw []byte) any {
	var output any
	switch outputType {
	case "raw":
		// Base64 encoded HTTP response content - use the bodyRes
		output = base64.StdEncoding.EncodeToString(raw)
	case "response":
		// HTTP response
		output = httpResp
	default:
		// Content
		output = httpResp.Content
	}

	return output
}
