package stigmer_test

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// =============================================================================
// Integration Scenarios - Multi-Resource Workflows
// =============================================================================

// TestIntegration_CompleteWorkflowWithAgent tests end-to-end workflow with agent integration.
func TestIntegration_CompleteWorkflowWithAgent(t *testing.T) {
	var capturedWorkflow *workflow.Workflow
	var capturedAgent *agent.Agent

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create a skill for the agent
		codeSkill, err := skill.New(
			skill.WithName("code-analysis"),
			skill.WithMarkdown("# Code Analysis\nAnalyze code quality"),
		)
		if err != nil {
			return err
		}

		// Create agent
		codeReviewer, err := agent.New(ctx,
			agent.WithName("code-reviewer"),
			agent.WithInstructions("Review code and provide detailed feedback on quality and best practices"),
			agent.WithSkills(*codeSkill),
		)
		if err != nil {
			return err
		}
		capturedAgent = codeReviewer

		// Create workflow that uses the agent
		wf, err := workflow.New(ctx,
			workflow.WithName("pr-review-workflow"),
			workflow.WithNamespace("ci-cd"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Automated PR review workflow"),
		)
		if err != nil {
			return err
		}

		// Add HTTP task using basic API
		fetchPR := wf.HttpGet("fetchPR", "https://api.github.com/pulls/123",
			workflow.Header("Authorization", "Bearer ${GITHUB_TOKEN}"),
			workflow.Timeout(30),
		)

		// Add agent call task (using low-level API since high-level not yet implemented)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "reviewCode",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "code-reviewer",
				Message: "${fetchPR.body}",
			},
			ExportAs: "${.}",
		})

		// Add comment posting task
		wf.HttpPost("postComment", "https://api.github.com/pulls/123/comments",
			workflow.Header("Content-Type", "application/json"),
			workflow.Timeout(15),
		)

		_ = fetchPR
		capturedWorkflow = wf
		return nil
	})

	if err != nil {
		t.Fatalf("Integration test failed: %v", err)
	}

	// Verify agent was created
	if capturedAgent == nil {
		t.Fatal("Agent was not captured")
	}

	agentProto, err := capturedAgent.ToProto()
	if err != nil {
		t.Fatalf("Agent ToProto() failed: %v", err)
	}

	if agentProto.Metadata.Name != "code-reviewer" {
		t.Errorf("Agent name = %v, want code-reviewer", agentProto.Metadata.Name)
	}

	// Verify workflow was created
	if capturedWorkflow == nil {
		t.Fatal("Workflow was not captured")
	}

	wfProto, err := capturedWorkflow.ToProto()
	if err != nil {
		t.Fatalf("Workflow ToProto() failed: %v", err)
	}

	if len(wfProto.Spec.Tasks) != 3 {
		t.Errorf("Expected 3 tasks, got %d", len(wfProto.Spec.Tasks))
	}
}

// TestIntegration_MultiAgentWorkflow tests workflow coordinating multiple agents.
func TestIntegration_MultiAgentWorkflow(t *testing.T) {
	var capturedWorkflow *workflow.Workflow

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create specialized agents
		securityAgent, err := agent.New(ctx,
			agent.WithName("security-reviewer"),
			agent.WithInstructions("Review code for security vulnerabilities and provide mitigation recommendations"),
		)
		if err != nil {
			return err
		}

		performanceAgent, err := agent.New(ctx,
			agent.WithName("performance-analyzer"),
			agent.WithInstructions("Analyze code performance and suggest optimizations"),
		)
		if err != nil {
			return err
		}

		docsAgent, err := agent.New(ctx,
			agent.WithName("documentation-writer"),
			agent.WithInstructions("Generate comprehensive documentation for code changes"),
		)
		if err != nil {
			return err
		}

		// Create workflow orchestrating all agents
		wf, err := workflow.New(ctx,
			workflow.WithName("comprehensive-review"),
			workflow.WithNamespace("code-review"),
			workflow.WithVersion("1.0.0"),
		)
		if err != nil {
			return err
		}

		// Fetch code
		fetchCode := wf.HttpGet("fetchCode", "https://api.example.com/code")

		// Add agent call tasks using low-level API
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "securityReview",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "security-reviewer",
				Message: "${fetchCode.content}",
			},
			ExportAs: "${.}",
		})

		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "performanceReview",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "performance-analyzer",
				Message: "${fetchCode.content}",
			},
			ExportAs: "${.}",
		})

		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "generateDocs",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "documentation-writer",
				Message: "Generate docs based on security and performance reviews",
			},
		})

		_ = fetchCode
		_ = securityAgent
		_ = performanceAgent
		_ = docsAgent
		capturedWorkflow = wf
		return nil
	})

	if err != nil {
		t.Fatalf("Multi-agent integration test failed: %v", err)
	}

	if capturedWorkflow == nil {
		t.Fatal("Workflow was not captured")
	}

	wfProto, err := capturedWorkflow.ToProto()
	if err != nil {
		t.Fatalf("Workflow ToProto() failed: %v", err)
	}

	if len(wfProto.Spec.Tasks) != 4 {
		t.Errorf("Expected 4 tasks, got %d", len(wfProto.Spec.Tasks))
	}
}

// =============================================================================
// Integration Scenarios - Agent with Complex Dependencies
// =============================================================================

// TestIntegration_AgentWithAllFeatures tests agent with all nested resources.
func TestIntegration_AgentWithAllFeatures(t *testing.T) {
	var capturedAgent *agent.Agent

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create multiple skills
		skill1, _ := skill.New(
			skill.WithName("skill1"),
			skill.WithMarkdown("# Skill 1\nFirst skill"),
		)

		skill2, _ := skill.New(
			skill.WithName("skill2"),
			skill.WithMarkdown("# Skill 2\nSecond skill"),
		)

		// Create environment variables
		env1, _ := environment.New(
			environment.WithName("API_KEY"),
			environment.WithSecret(true),
		)

		env2, _ := environment.New(
			environment.WithName("REGION"),
			environment.WithDefaultValue("us-east-1"),
		)

		// Create comprehensive agent (simplified - without MCP servers and sub-agents)
		comprehensiveAgent, err := agent.New(ctx,
			agent.WithName("comprehensive-agent"),
			agent.WithSlug("comprehensive-agent"),
			agent.WithDescription("Agent with all features for integration testing"),
			agent.WithIconURL("https://example.com/icon.png"),
			agent.WithInstructions("Comprehensive agent with skills and environment variables for integration testing"),
			agent.WithSkills(*skill1, *skill2),
			agent.WithEnvironmentVariables(env1, env2),
		)
		if err != nil {
			return err
		}

		capturedAgent = comprehensiveAgent
		return nil
	})

	if err != nil {
		t.Fatalf("Comprehensive agent test failed: %v", err)
	}

	if capturedAgent == nil {
		t.Fatal("Agent was not captured")
	}

	agentProto, err := capturedAgent.ToProto()
	if err != nil {
		t.Fatalf("Agent ToProto() failed: %v", err)
	}

	// Verify features
	if len(agentProto.Spec.SkillRefs) != 2 {
		t.Errorf("Expected 2 skills, got %d", len(agentProto.Spec.SkillRefs))
	}

	if len(agentProto.Spec.EnvSpec.Data) != 2 {
		t.Errorf("Expected 2 env vars, got %d", len(agentProto.Spec.EnvSpec.Data))
	}
}

// =============================================================================
// Integration Scenarios - Dependency Tracking
// =============================================================================

// TestIntegration_DependencyTracking tests automatic dependency tracking.
func TestIntegration_DependencyTracking(t *testing.T) {
	var ctx *stigmer.Context

	err := stigmer.Run(func(c *stigmer.Context) error {
		ctx = c

		// Create inline skills
		skill1, _ := skill.New(
			skill.WithName("coding"),
			skill.WithMarkdown("# Coding\nCoding guidelines"),
		)

		skill2, _ := skill.New(
			skill.WithName("security"),
			skill.WithMarkdown("# Security\nSecurity best practices"),
		)

		// Create agents with inline skills
		agent1, err := agent.New(ctx,
			agent.WithName("code-reviewer"),
			agent.WithInstructions("Review code for best practices"),
			agent.WithSkills(*skill1),
		)
		if err != nil {
			return err
		}

		agent2, err := agent.New(ctx,
			agent.WithName("security-reviewer"),
			agent.WithInstructions("Review code for security issues"),
			agent.WithSkills(*skill2),
		)
		if err != nil {
			return err
		}

		// Create workflow using agents
		_, err = workflow.New(ctx,
			workflow.WithName("review-workflow"),
			workflow.WithNamespace("reviews"),
			workflow.WithVersion("1.0.0"),
		)
		if err != nil {
			return err
		}

		_ = agent1
		_ = agent2
		return nil
	})

	if err != nil {
		t.Fatalf("Dependency tracking test failed: %v", err)
	}

	// Verify dependencies were tracked
	deps := ctx.Dependencies()

	t.Logf("Tracked dependencies: %v", deps)

	// Check agent → skill dependencies
	agent1Deps := ctx.GetDependencies("agent:code-reviewer")
	if len(agent1Deps) == 0 {
		t.Error("Expected dependencies for code-reviewer agent")
	}

	agent2Deps := ctx.GetDependencies("agent:security-reviewer")
	if len(agent2Deps) == 0 {
		t.Error("Expected dependencies for security-reviewer agent")
	}

	// Verify skills were registered
	skills := ctx.Skills()
	if len(skills) < 2 {
		t.Errorf("Expected at least 2 skills registered, got %d", len(skills))
	}
}

// =============================================================================
// Integration Scenarios - Stress Testing
// =============================================================================

// TestIntegration_ManyResourcesStressTest tests system with many resources.
func TestIntegration_ManyResourcesStressTest(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping stress test in short mode")
	}

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create 50 skills
		skills := make([]skill.Skill, 50)
		for i := 0; i < 50; i++ {
			s, err := skill.New(
				skill.WithName("stress-skill-"+strings.Repeat("x", i%10)),
				skill.WithMarkdown("# Stress Skill "+string(rune('0'+i%10))),
			)
			if err != nil {
				return err
			}
			skills[i] = *s
		}

		// Create 20 agents
		for i := 0; i < 20; i++ {
			// Each agent gets 2-3 skills
			agentSkills := skills[i*2 : min(i*2+3, len(skills))]

			_, err := agent.New(ctx,
				agent.WithName("stress-agent-"+strings.Repeat("x", i%10)),
				agent.WithInstructions("Stress test agent "+string(rune('0'+i%10))+" for testing system capacity"),
				agent.WithSkills(agentSkills...),
			)
			if err != nil {
				return err
			}
		}

		// Create 10 workflows
		for i := 0; i < 10; i++ {
			wf, err := workflow.New(ctx,
				workflow.WithName("stress-workflow-"+strings.Repeat("x", i%10)),
				workflow.WithNamespace("stress-test"),
				workflow.WithVersion("1.0.0"),
			)
			if err != nil {
				return err
			}

			// Add 10 tasks per workflow
			for j := 0; j < 10; j++ {
				wf.Set("task-"+string(rune('0'+j)),
					workflow.SetVar("key"+string(rune('0'+j)), "value"+string(rune('0'+j))),
				)
			}
		}

		return nil
	})

	if err != nil {
		t.Fatalf("Stress test failed: %v", err)
	}

	t.Log("Successfully created 50 skills, 20 agents, and 10 workflows with 10 tasks each")
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// =============================================================================
// Integration Scenarios - Real-World Patterns
// =============================================================================

// TestIntegration_RealWorld_DataPipeline tests a realistic data pipeline.
func TestIntegration_RealWorld_DataPipeline(t *testing.T) {
	var capturedWorkflow *workflow.Workflow

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create data transformation agent
		dataTransformer, err := agent.New(ctx,
			agent.WithName("data-transformer"),
			agent.WithInstructions("Transform and validate data records according to schema rules"),
		)
		if err != nil {
			return err
		}

		// Create data quality agent
		dataQuality, err := agent.New(ctx,
			agent.WithName("data-quality-checker"),
			agent.WithInstructions("Check data quality and identify anomalies or inconsistencies"),
		)
		if err != nil {
			return err
		}

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithName("daily-data-pipeline"),
			workflow.WithNamespace("data-pipelines"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Daily data processing and validation pipeline"),
		)
		if err != nil {
			return err
		}

		// Fetch data from source
		fetchData := wf.HttpGet("fetchSourceData", "https://api.datasource.com/daily-export",
			workflow.Header("Authorization", "Bearer ${API_TOKEN}"),
			workflow.Timeout(120),
		)

		// Transform data (low-level API)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "transformData",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "data-transformer",
				Message: "${fetchSourceData.records}",
			},
			ExportAs: "${.}",
		})

		// Quality check (low-level API)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "qualityCheck",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "data-quality-checker",
				Message: "${transformData.transformed}",
			},
			ExportAs: "${.}",
		})

		// Load to destination
		wf.HttpPost("loadData", "https://api.datawarehouse.com/load",
			workflow.Header("Content-Type", "application/json"),
			workflow.Timeout(60),
		)

		_ = fetchData
		_ = dataTransformer
		_ = dataQuality
		capturedWorkflow = wf
		return nil
	})

	if err != nil {
		t.Fatalf("Data pipeline integration test failed: %v", err)
	}

	if capturedWorkflow == nil {
		t.Fatal("Workflow was not captured")
	}

	wfProto, err := capturedWorkflow.ToProto()
	if err != nil {
		t.Fatalf("Workflow ToProto() failed: %v", err)
	}

	if len(wfProto.Spec.Tasks) != 4 {
		t.Errorf("Expected 4 tasks, got %d", len(wfProto.Spec.Tasks))
	}

	t.Log("Data pipeline workflow created successfully")
}

// TestIntegration_RealWorld_CustomerSupport tests a customer support workflow.
func TestIntegration_RealWorld_CustomerSupport(t *testing.T) {
	var capturedWorkflow *workflow.Workflow

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create support agents
		ticketClassifier, _ := agent.New(ctx,
			agent.WithName("ticket-classifier"),
			agent.WithInstructions("Classify support tickets by urgency, category, and required expertise"),
		)

		responseGenerator, _ := agent.New(ctx,
			agent.WithName("response-generator"),
			agent.WithInstructions("Generate helpful and empathetic customer support responses"),
		)

		// Create workflow
		wf, err := workflow.New(ctx,
			workflow.WithName("customer-support-automation"),
			workflow.WithNamespace("support"),
			workflow.WithVersion("1.0.0"),
		)
		if err != nil {
			return err
		}

		// Receive ticket
		receiveTicket := wf.HttpGet("receiveTicket", "https://api.support.com/tickets/next")

		// Classify ticket (low-level API)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "classifyTicket",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "ticket-classifier",
				Message: "${receiveTicket.content}",
			},
			ExportAs: "${.}",
		})

		// Generate response (low-level API)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "generateResponse",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "response-generator",
				Message: "Generate response for ticket: ${receiveTicket.content}",
			},
			ExportAs: "${.}",
		})

		// Send response
		wf.HttpPost("sendResponse", "https://api.support.com/tickets/respond",
			workflow.Header("Content-Type", "application/json"),
		)

		_ = receiveTicket
		_ = ticketClassifier
		_ = responseGenerator
		capturedWorkflow = wf
		return nil
	})

	if err != nil {
		t.Fatalf("Customer support integration test failed: %v", err)
	}

	if capturedWorkflow == nil {
		t.Fatal("Workflow was not captured")
	}

	wfProto, err := capturedWorkflow.ToProto()
	if err != nil {
		t.Fatalf("Workflow ToProto() failed: %v", err)
	}

	if len(wfProto.Spec.Tasks) != 4 {
		t.Errorf("Expected 4 tasks, got %d", len(wfProto.Spec.Tasks))
	}

	t.Log("Customer support workflow created successfully")
}

// =============================================================================
// Integration Scenarios - Error Handling and Recovery
// =============================================================================

// TestIntegration_ErrorRecovery tests workflows with error handling.
func TestIntegration_ErrorRecovery(t *testing.T) {
	var capturedWorkflow *workflow.Workflow

	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// Create fallback agent
		fallbackAgent, _ := agent.New(ctx,
			agent.WithName("fallback-handler"),
			agent.WithInstructions("Handle errors and provide fallback responses"),
		)

		// Create workflow with error handling
		wf, err := workflow.New(ctx,
			workflow.WithName("resilient-workflow"),
			workflow.WithNamespace("resilience"),
			workflow.WithVersion("1.0.0"),
		)
		if err != nil {
			return err
		}

		// Risky API call
		riskyCall := wf.HttpGet("riskyAPICall", "https://api.unreliable.com/data",
			workflow.Timeout(10),
		)

		// Fallback agent call on error (low-level API)
		wf.Tasks = append(wf.Tasks, &workflow.Task{
			Name: "handleError",
			Kind: workflow.TaskKindAgentCall,
			Config: &workflow.AgentCallTaskConfig{
				Agent:   "fallback-handler",
				Message: "Handle error from API call",
			},
		})

		_ = riskyCall
		_ = fallbackAgent

		capturedWorkflow = wf
		return nil
	})

	if err != nil {
		t.Fatalf("Error recovery integration test failed: %v", err)
	}

	if capturedWorkflow == nil {
		t.Fatal("Workflow was not captured")
	}

	t.Log("Error recovery workflow created successfully")
}
