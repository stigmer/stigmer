//go:build integration

package integration

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

// Regression tests for env variable interpolation in agent_call messages.
//
// These tests specifically target the scenario observed in production where
// optional env vars like NOTIFICATION_DATE pass through as literal
// `${ $env.NOTIFICATION_DATE }` text instead of being resolved to an empty
// string by the workflow engine's Phase 2 embedded expression interpolation.
//
// The production pattern: the daily-notification-plan workflow declares
// NOTIFICATION_DATE as optional, embeds it in a multi-line agent_call message,
// and the user triggers the workflow without providing a value. The expression
// engine should resolve it to "" (empty string), not leave the raw placeholder.
//
// Production timeline (from MongoDB analysis, May 2026):
//   - Pre-May 23: expressions used wrong namespace ($context.env) — always unresolved
//   - May 23: namespace fixed to $env + Phase 2 interpolation added
//   - May 24+: intermittent — some executions resolved, some did not
//
// These tests lock down the expected behavior so any regression in the
// expression interpolation pipeline is caught before production.

func TestWorkflowEnvInterpolation_OptionalVarMissing_ResolvesToEmpty(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "env-interp-missing", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvInterpolationAgent(t, ctx, clients, "missing")

	// Multi-line message matching the production daily-notification-plan pattern:
	// NOTIFICATION_DATE is embedded in the middle of a multi-line message.
	message := strings.Join([]string{
		"Generate the daily cohort analysis report for Garden Design Makeover.",
		"Date: ${ $env.NOTIFICATION_DATE }",
		"Data source: `decor` schema in the TT Analytics Postgres database.",
		"Analyze the following: 1. Current DAU 2. Cohort breakdown",
	}, "\n")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": message,
	})
	require.NoError(t, err)

	workflow := buildEnvInterpolationWorkflow(t, "env-interp-missing",
		map[string]*environmentv1.EnvVarDeclaration{
			"NOTIFICATION_DATE": {
				Description: "Date for notification plan (ISO 8601). Defaults to today if omitted.",
				Optional:    true,
			},
		},
		taskConfig,
	)

	// Do NOT provide NOTIFICATION_DATE in runtimeEnv — this is the production
	// case where the user leaves the optional field blank in the UI.
	_, execution, err := deployer.DeployAndExecute(ctx, workflow, "env interpolation regression test")
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	childExec := findChildAgentExecutionForWorkflow(t, ctx, clients, executionID, 60*time.Second)
	require.NotNil(t, childExec,
		"CallAgent activity should have created a child AgentExecution for workflow execution %s", executionID)

	childMessage := childExec.GetSpec().GetMessage()
	t.Logf("child agent execution message:\n%s", childMessage)

	assert.Contains(t, childMessage, "Date: \n",
		"missing optional ${ $env.NOTIFICATION_DATE } should resolve to empty string, "+
			"producing 'Date: \\n' (empty value followed by newline)")

	assert.NotContains(t, childMessage, "${ $env.",
		"no raw expression placeholders should remain in the resolved message")

	assert.NotContains(t, childMessage, "${",
		"no expression syntax of any kind should remain in the message")

	assert.Contains(t, childMessage, "Generate the daily cohort",
		"static text before the expression should be preserved")

	assert.Contains(t, childMessage, "Data source:",
		"static text after the expression should be preserved")
}

func TestWorkflowEnvInterpolation_OptionalVarProvided_ResolvesToValue(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "env-interp-provided", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvInterpolationAgent(t, ctx, clients, "provided")

	message := strings.Join([]string{
		"Generate the daily cohort analysis report.",
		"Date: ${ $env.NOTIFICATION_DATE }",
		"Proceed with analysis.",
	}, "\n")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": message,
	})
	require.NoError(t, err)

	workflow := buildEnvInterpolationWorkflow(t, "env-interp-provided",
		map[string]*environmentv1.EnvVarDeclaration{
			"NOTIFICATION_DATE": {
				Description: "Date for notification plan (ISO 8601).",
				Optional:    true,
			},
		},
		taskConfig,
	)

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"NOTIFICATION_DATE": {Value: "2026-05-26"},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "env interpolation test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	childExec := findChildAgentExecutionForWorkflow(t, ctx, clients, executionID, 60*time.Second)
	require.NotNil(t, childExec,
		"CallAgent activity should have created a child AgentExecution for workflow execution %s", executionID)

	childMessage := childExec.GetSpec().GetMessage()
	t.Logf("child agent execution message:\n%s", childMessage)

	assert.Contains(t, childMessage, "Date: 2026-05-26",
		"provided ${ $env.NOTIFICATION_DATE } should be interpolated to '2026-05-26'")

	assert.NotContains(t, childMessage, "${ $env.",
		"no raw expression placeholders should remain in the resolved message")
}

func TestWorkflowEnvInterpolation_MultiLineMultipleEnvRefs(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "env-interp-multi", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvInterpolationAgent(t, ctx, clients, "multi")

	// Multi-line message with multiple env refs: one provided, one missing optional.
	// This mirrors the production daily-notification-plan pattern where
	// POSTGRES_CONNECTION_URL is provided (secret) and NOTIFICATION_DATE is optional.
	message := strings.Join([]string{
		"Generate the daily cohort analysis report for Garden Design Makeover.",
		"",
		"Date: ${ $env.NOTIFICATION_DATE }",
		"",
		"Data source: ${ $env.DATA_SOURCE_NAME }",
		"",
		"Analyze the following:",
		"1. Current DAU",
		"2. Cohort breakdown using provided data source",
		"3. Retention metrics",
	}, "\n")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": message,
	})
	require.NoError(t, err)

	workflow := buildEnvInterpolationWorkflow(t, "env-interp-multi",
		map[string]*environmentv1.EnvVarDeclaration{
			"NOTIFICATION_DATE": {
				Description: "Date for notification plan. Optional.",
				Optional:    true,
			},
			"DATA_SOURCE_NAME": {
				Description: "Name of the data source to query.",
			},
		},
		taskConfig,
	)

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"DATA_SOURCE_NAME": {Value: "decor-analytics-prod"},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "multi-env interpolation test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	childExec := findChildAgentExecutionForWorkflow(t, ctx, clients, executionID, 60*time.Second)
	require.NotNil(t, childExec,
		"CallAgent activity should have created a child AgentExecution for workflow execution %s", executionID)

	childMessage := childExec.GetSpec().GetMessage()
	t.Logf("child agent execution message:\n%s", childMessage)

	assert.Contains(t, childMessage, "Data source: decor-analytics-prod",
		"provided ${ $env.DATA_SOURCE_NAME } should be interpolated to 'decor-analytics-prod'")

	assert.Contains(t, childMessage, "Date: \n",
		"missing optional ${ $env.NOTIFICATION_DATE } should resolve to empty string")

	assert.NotContains(t, childMessage, "${ $env.",
		"no raw expression placeholders should remain in the resolved message")

	assert.NotContains(t, childMessage, "${",
		"no expression syntax of any kind should remain in the message")

	assert.Contains(t, childMessage, "1. Current DAU",
		"static text in the multi-line message should be fully preserved")

	assert.Contains(t, childMessage, "3. Retention metrics",
		"trailing static text should be preserved")
}

func TestWorkflowEnvInterpolation_RequiredVarProvided_ResolvesCorrectly(t *testing.T) {
	requireAgentCallPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)
	deployer := harness.NewFixtureDeployer(clients, "env-interp-req", suiteLogger)
	defer deployer.Cleanup(ctx)

	agent := createEnvInterpolationAgent(t, ctx, clients, "required")

	message := strings.Join([]string{
		"Connect to the database and run the analysis.",
		"Connection URL: ${ $env.DB_CONNECTION_URL }",
		"Report format: ${ $env.REPORT_FORMAT }",
		"Proceed.",
	}, "\n")

	taskConfig, err := structpb.NewStruct(map[string]any{
		"agent":   agent.GetMetadata().GetSlug(),
		"org":     harness.TestOrg,
		"message": message,
	})
	require.NoError(t, err)

	workflow := buildEnvInterpolationWorkflow(t, "env-interp-required",
		map[string]*environmentv1.EnvVarDeclaration{
			"DB_CONNECTION_URL": {
				Description: "Database connection URL.",
				IsSecret:    true,
			},
			"REPORT_FORMAT": {
				Description: "Output format for the report.",
			},
		},
		taskConfig,
	)

	runtimeEnv := map[string]*executionctxv1.ExecutionValue{
		"DB_CONNECTION_URL": {Value: "postgresql://test:test@localhost:5432/analytics", IsSecret: true},
		"REPORT_FORMAT":     {Value: "json"},
	}

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, workflow, "required env interpolation test", runtimeEnv)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	require.NotEmpty(t, executionID)
	t.Logf("workflow execution created: id=%s", executionID)

	childExec := findChildAgentExecutionForWorkflow(t, ctx, clients, executionID, 60*time.Second)
	require.NotNil(t, childExec,
		"CallAgent activity should have created a child AgentExecution for workflow execution %s", executionID)

	childMessage := childExec.GetSpec().GetMessage()
	t.Logf("child agent execution message:\n%s", childMessage)

	assert.Contains(t, childMessage, "Connection URL: postgresql://test:test@localhost:5432/analytics",
		"provided secret ${ $env.DB_CONNECTION_URL } should be interpolated with the actual value")

	assert.Contains(t, childMessage, "Report format: json",
		"provided ${ $env.REPORT_FORMAT } should be interpolated to 'json'")

	assert.NotContains(t, childMessage, "${ $env.",
		"no raw expression placeholders should remain in the resolved message")

	assert.Contains(t, childMessage, "Connect to the database",
		"static text before expressions should be preserved")

	assert.Contains(t, childMessage, "Proceed.",
		"static text after expressions should be preserved")
}

// --- Shared test helpers ---

func createEnvInterpolationAgent(t *testing.T, ctx context.Context, clients *harness.Clients, suffix string) *agentv1.Agent {
	t.Helper()

	agent := &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("test-env-interp-%s", suffix),
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Integration test agent for env interpolation regression tests",
			Instructions: "You are a test agent. Reply with exactly what is asked.",
		},
	}

	created, err := clients.AgentCommand.Apply(ctx, agent)
	require.NoError(t, err, "apply agent should succeed")

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = clients.AgentCommand.Delete(cleanCtx, &agentv1.AgentId{Value: created.GetMetadata().GetId()})
	})

	return created
}

func buildEnvInterpolationWorkflow(
	t *testing.T,
	name string,
	envDecls map[string]*environmentv1.EnvVarDeclaration,
	taskConfig *structpb.Struct,
) *workflowv1.Workflow {
	t.Helper()

	return &workflowv1.Workflow{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("integration-test-%s", name),
			Org:  harness.TestOrg,
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: fmt.Sprintf("Integration test: %s", name),
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: harness.TestOrg,
				Name:      fmt.Sprintf("integration-test-%s", name),
				Version:   "1.0.0",
			},
			Env:  envDecls,
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "callAgent",
					Kind:       workflowv1.WorkflowTaskKind_agent_call,
					TaskConfig: taskConfig,
				},
			},
		},
	}
}
