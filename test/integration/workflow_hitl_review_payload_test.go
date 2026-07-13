//go:build integration

package integration

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// TestWorkflowHITL_ReviewPayloadInline verifies the review-payload flow
// (stigmer/stigmer#234) for a payload below the artifact promotion
// threshold:
//
//  1. A set_vars task exports structured data into $context
//  2. A human_input task declares payload: ${ $context.prepare } + ui_hint
//  3. The approval_requested event carries the RESOLVED payload inline
//     plus the ui_hint verbatim (the audit property: the event records
//     exactly what the reviewer saw)
//  4. The approval submit path is unchanged — the gate completes normally
func TestWorkflowHITL_ReviewPayloadInline(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-payload-inline", suiteLogger)
	defer deployer.Cleanup(ctx)

	prepareConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"plan_title":   "Q3 rollout",
			"record_count": float64(3),
		},
	})
	require.NoError(t, err)

	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt":  "Review the prepared plan",
		"payload": "${ $context.prepare }",
		"ui_hint": "plan-review",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-payload-inline",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input review payload (inline)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-payload-inline",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "prepare",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: prepareConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
				{
					Name:       "reviewGate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "review payload inline test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "reviewGate", 90*time.Second)
	require.NoError(t, err, "task should reach WAITING_APPROVAL")

	requested := waitForApprovalRequestedEvent(t, ctx, clients, executionID, "reviewGate")

	require.Equal(t, "plan-review", requested.GetUiHint(),
		"ui_hint should carry verbatim from task config to the event")
	require.Empty(t, requested.GetPayloadArtifactId(),
		"small payload must ride the event inline, not as an artifact")
	require.NotNil(t, requested.GetPayload(), "resolved payload should be on the event")

	payload := requested.GetPayload().GetStructValue()
	require.NotNil(t, payload, "payload should have resolved to the prepared object")
	require.Equal(t, "Q3 rollout", payload.GetFields()["plan_title"].GetStringValue(),
		"payload must be the RESOLVED value, not the expression string")

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "reviewGate",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "the submit contract is unchanged by review payloads")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("inline review payload flow completed: payload + ui_hint recorded on approval_requested")
}

// TestWorkflowHITL_ReviewPayloadArtifactBacked verifies the review-payload
// flow for a payload at/above the 256KB promotion threshold:
//
//  1. The gate's payload expression materializes a large array (~350KB
//     serialized) at gate activation
//  2. The resolved payload is promoted to the artifact store; the
//     approval_requested event carries payload_artifact_id instead of
//     inline data
//  3. ArtifactQueryController.getContent returns the complete payload
//     (the API-proxied read path SDK renderers use)
//  4. The gate still completes normally on approval
//
// The large value is generated by the payload expression itself rather
// than exported from an upstream task: task exports of this size stall
// the engine between tasks — a pre-existing limitation unrelated to
// review payloads (observed with a payload-less gate downstream of a
// ~350KB export; tracked separately).
func TestWorkflowHITL_ReviewPayloadArtifactBacked(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "hitl-payload-artifact", suiteLogger)
	defer deployer.Cleanup(ctx)

	// 60000 numbers serialize to ~350KB — comfortably above the 256KB
	// promotion threshold, comfortably below Temporal/gRPC limits.
	const elementCount = 60000
	humanInputConfig, err := structpb.NewStruct(map[string]any{
		"prompt":  "Review the proposed record set",
		"payload": "${ [range(0;60000)] }",
		"ui_hint": "infra-proposal",
		"outcomes": []any{
			map[string]any{"name": "approve", "label": "Approve"},
			map[string]any{"name": "reject", "label": "Reject"},
		},
		"timeout": float64(120),
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "integration-test-hitl-payload-artifact",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Integration test: human_input review payload (artifact-backed)",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "integration-test-hitl-payload-artifact",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "reviewGate",
					Kind:       workflowv1.WorkflowTaskKind_human_input,
					TaskConfig: humanInputConfig,
					Export:     &workflowv1.Export{As: "${ . }"},
				},
			},
		},
	}

	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "review payload artifact test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "reviewGate", 120*time.Second)
	require.NoError(t, err, "task should reach WAITING_APPROVAL")

	requested := waitForApprovalRequestedEvent(t, ctx, clients, executionID, "reviewGate")

	require.Equal(t, "infra-proposal", requested.GetUiHint())
	require.NotEmpty(t, requested.GetPayloadArtifactId(),
		"a payload above the promotion threshold must ride as an artifact reference")
	require.Nil(t, requested.GetPayload(),
		"payload and payload_artifact_id are mutually exclusive")

	// Verify the payload survives the promote/store round trip intact,
	// through the edition-neutral download-URL path.
	artifactQuery := artifactv1.NewArtifactQueryControllerClient(grpcConn)
	dl, err := artifactQuery.GetDownloadUrl(ctx,
		&artifactv1.ArtifactId{Value: requested.GetPayloadArtifactId()})
	require.NoError(t, err, "getDownloadUrl should resolve the promoted payload artifact")
	require.Greater(t, dl.GetSizeBytes(), int64(256*1024),
		"the payload should genuinely exceed the promotion threshold")

	downloaded := httpGet(t, ctx, dl.GetUrl())
	var records []float64
	require.NoError(t, json.Unmarshal(downloaded, &records),
		"artifact content should be the payload JSON")
	require.Len(t, records, elementCount,
		"the complete payload must survive the promote/store round trip")

	// Also exercise getContent — the API-proxied read path SDK review
	// renderers use. The Go (OSS) edition implements it; the Java (Cloud)
	// handler is the linked cloud-parity follow-up, so UNIMPLEMENTED from
	// a cloud-edition service under test is expected until that lands.
	// No skip flag: the assertion activates automatically once it does.
	content, err := artifactQuery.GetContent(ctx, &artifactv1.GetArtifactContentRequest{
		ArtifactId: requested.GetPayloadArtifactId(),
		MaxBytes:   50 * 1024 * 1024,
	})
	if status.Code(err) == codes.Unimplemented {
		t.Logf("getContent UNIMPLEMENTED on the serving edition — covered by the cloud-parity follow-up (stigmer/stigmer#234)")
	} else {
		require.NoError(t, err, "getContent should return the promoted payload")
		require.False(t, content.GetTruncated(), "the full payload must be readable")
		require.Equal(t, dl.GetSizeBytes(), content.GetTotalSizeBytes(),
			"getContent and getDownloadUrl must agree on the payload size")
		var proxied []float64
		require.NoError(t, json.Unmarshal(content.GetContent(), &proxied))
		require.Len(t, proxied, elementCount,
			"the complete payload must survive the API-proxied read")
	}

	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "reviewGate",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err)

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	t.Logf("artifact-backed review payload flow completed: artifact_id=%s, %d records verified",
		requested.GetPayloadArtifactId(), len(records))
}

// httpGet downloads a URL and returns the body. The test-harness MinIO
// endpoint uses a self-signed certificate, so verification is skipped —
// acceptable for test infrastructure, never for production code.
func httpGet(t *testing.T, ctx context.Context, url string) []byte {
	t.Helper()

	client := &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
		},
		Timeout: 30 * time.Second,
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	require.NoError(t, err)

	resp, err := client.Do(req)
	require.NoError(t, err, "download from %s should succeed", url)
	defer resp.Body.Close()
	require.Equal(t, http.StatusOK, resp.StatusCode, "download should return 200")

	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	return body
}

// waitForApprovalRequestedEvent polls the event log until the
// approval_requested event for the given task appears. Events ride the
// same status-update pipeline as the WAITING_APPROVAL flip but polling
// keeps the test deterministic if the two ever land in separate writes.
func waitForApprovalRequestedEvent(
	t *testing.T,
	ctx context.Context,
	clients *harness.Clients,
	executionID string,
	taskName string,
) *workflowexecutionv1.ApprovalRequestedPayload {
	t.Helper()

	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		log, err := clients.ExecutionQuery.GetEventLog(ctx,
			&workflowexecutionv1.GetEventLogRequest{
				ExecutionId:   executionID,
				AfterSequence: 0,
			})
		require.NoError(t, err, "getEventLog should succeed for execution %s", executionID)

		for _, evt := range log.GetEvents() {
			if evt.GetEventType() == workflowexecutionv1.WorkflowEventType_approval_requested &&
				evt.GetTaskName() == taskName {
				return evt.GetApprovalRequested()
			}
		}

		select {
		case <-ctx.Done():
			t.Fatalf("context cancelled waiting for approval_requested event: %v", ctx.Err())
		case <-time.After(500 * time.Millisecond):
		}
	}

	t.Fatalf("approval_requested event for task %q not found within 30s on execution %s",
		taskName, executionID)
	return nil
}
