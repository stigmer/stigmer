//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// Multi-agent project with dependencies for testing:
// - Dependency ordering (MCP Server -> Agents -> Workflow)
// - Multiple agent deployment
// - Resource reconciliation
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================================================
		// Step 1: Create MCP Server (dependency of agents)
		// ============================================================================
		dataSourceMcp, err := mcpserver.Stdio(
			mcpserver.WithName("data-source-mcp"),
			mcpserver.WithCommand("echo"),
			mcpserver.WithArgs("data-source"),
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 2: Create Agents (depend on MCP Server)
		// ============================================================================
		etlAgent, err := agent.New(ctx, "etl-agent", &agent.AgentArgs{
			Instructions: "You are an ETL agent that extracts, transforms, and loads data.",
			Description:  "ETL processing agent for data pipelines",
		})
		if err != nil {
			return err
		}
		etlAgent.AddMCPServers(dataSourceMcp)

		validatorAgent, err := agent.New(ctx, "validator-agent", &agent.AgentArgs{
			Instructions: "You are a validator agent that validates data quality.",
			Description:  "Data validation agent",
		})
		if err != nil {
			return err
		}

		reporterAgent, err := agent.New(ctx, "reporter-agent", &agent.AgentArgs{
			Instructions: "You are a reporter agent that generates reports.",
			Description:  "Report generation agent",
		})
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 3: Create Workflow (depends on agents)
		// ============================================================================
		dataPipeline, err := workflow.New(ctx,
			workflow.WithNamespace("data-processing"),
			workflow.WithName("data-pipeline"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Data processing pipeline workflow"),
		)
		if err != nil {
			return err
		}

		// Create workflow tasks that call agents
		extractTask := dataPipeline.CallAgent("extract_data", &workflow.AgentCallArgs{
			Agent:   workflow.Agent(etlAgent).Slug(),
			Message: "Extract data from source",
		})

		validateTask := dataPipeline.CallAgent("validate_data", &workflow.AgentCallArgs{
			Agent:      workflow.Agent(validatorAgent).Slug(),
			Message:    "Validate the extracted data",
			DependsOn:  extractTask,
		})

		dataPipeline.CallAgent("generate_report", &workflow.AgentCallArgs{
			Agent:      workflow.Agent(reporterAgent).Slug(),
			Message:    "Generate data quality report",
			DependsOn:  validateTask,
		})

		log.Println("Created multi-agent-orchestrator with:")
		log.Println("  - 1 MCP Server: data-source-mcp")
		log.Println("  - 3 Agents: etl-agent, validator-agent, reporter-agent")
		log.Println("  - 1 Workflow: data-pipeline")

		return nil
	})

	if err != nil {
		log.Fatalf("Error: %v", err)
	}
}
