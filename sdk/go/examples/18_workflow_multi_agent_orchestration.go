//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example demonstrates complex multi-agent orchestration:
// Multiple specialized agents working together in a pipeline.
//
// Real-world scenario: Automated PR review and deployment pipeline
//
// Pipeline flow:
// 1. Fetch PR from GitHub
// 2. Agent 1: Security scan (specialized security agent)
// 3. Agent 2: Code quality review (code reviewer agent)
// 4. Agent 3: Performance analysis (performance agent)
// 5. Aggregate results and make deployment decision
// 6. Agent 4: Generate deployment plan (DevOps agent)
// 7. Execute deployment
// 8. Agent 5: Post-deployment verification (QA agent)
//
// Key learning points:
// - Multiple agents with different specializations
// - Sequential agent execution with data flow
// - Using task outputs as inputs to next agents
// - Combining HTTP tasks with agent tasks
// - Real-world CI/CD automation pattern
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================================================
		// Create specialized agents
		// ============================================================================
		securityAgent, err := agent.New(ctx, "security-scanner", &agent.AgentArgs{
			Instructions: `You are a security expert. Scan code for:
- SQL injection vulnerabilities
- XSS vulnerabilities
- Authentication/authorization issues
- Hardcoded secrets
- Dependency vulnerabilities

Return JSON: {"risk_level": "low|medium|high", "issues": [...], "recommendation": "approve|reject"}`,
		})
		if err != nil {
			return err
		}

		codeReviewAgent, err := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
			Instructions: `You are a senior code reviewer. Analyze:
- Code quality and maintainability
- Test coverage
- Documentation
- Best practices
- Design patterns

Return JSON: {"quality_score": 0-100, "issues": [...], "recommendation": "approve|request_changes"}`,
		})
		if err != nil {
			return err
		}

		performanceAgent, err := agent.New(ctx, "performance-analyzer", &agent.AgentArgs{
			Instructions: `You are a performance expert. Analyze:
- Algorithm complexity
- Database query efficiency
- Memory usage patterns
- Potential bottlenecks
- Caching opportunities

Return JSON: {"performance_score": 0-100, "concerns": [...], "recommendation": "approve|optimize"}`,
		})
		if err != nil {
			return err
		}

		devopsAgent, err := agent.New(ctx, "devops-planner", &agent.AgentArgs{
			Instructions: `You are a DevOps expert. Create deployment plans:
- Infrastructure changes required
- Migration scripts needed
- Rollback strategy
- Monitoring setup
- Feature flags

Return JSON: {"plan": {...}, "estimated_duration": "...", "risk_level": "low|medium|high"}`,
		})
		if err != nil {
			return err
		}

		qaAgent, err := agent.New(ctx, "qa-verifier", &agent.AgentArgs{
			Instructions: `You are a QA specialist. Verify deployments:
- Health check results
- API response times
- Error rates
- User impact
- Rollback needed?

Return JSON: {"status": "healthy|degraded|failed", "metrics": {...}, "action": "continue|rollback"}`,
		})
		if err != nil {
			return err
		}

		// ============================================================================
		// Create orchestration workflow
		// ============================================================================
		wf, err := workflow.New(ctx, "ci-cd/intelligent-deployment-pipeline", &workflow.WorkflowArgs{
			Description: "Multi-agent CI/CD pipeline with automated review and deployment",
		})
		if err != nil {
			return err
		}

		log.Println("🚀 Building intelligent deployment pipeline...")

		// ============================================================================
		// Step 1: Fetch PR details
		// ============================================================================
		fetchPR := wf.HttpGet("fetchPR",
			workflow.Interpolate("https://api.github.com/repos/myorg/myrepo/pulls/", workflow.RuntimeEnv("PR_NUMBER")),
			map[string]string{
				"Authorization": workflow.Interpolate("token ", workflow.RuntimeSecret("GITHUB_TOKEN")),
				"Accept":        "application/vnd.github.v3+json",
			},
		)
		log.Println("  ✅ Step 1: Fetch PR details")

		// ============================================================================
		// Step 2: Security scan (Agent 1)
		// ============================================================================
		securityScan := wf.CallAgent("securityScan", &workflow.AgentCallArgs{
			Agent: securityAgent.Slug, // Direct slug reference
			Message: workflow.Interpolate(
				"Scan this PR for security vulnerabilities:\n",
				"Title: ", fetchPR.Field("title"), "\n",
				"Files changed: ", fetchPR.Field("changed_files"), "\n",
				"Additions: ", fetchPR.Field("additions"), "\n",
				"Deletions: ", fetchPR.Field("deletions"), "\n",
			),
			Env: map[string]string{
				"GITHUB_TOKEN": workflow.RuntimeSecret("GITHUB_TOKEN"),
				"PR_NUMBER":    workflow.RuntimeEnv("PR_NUMBER"),
			},
			Config: &types.AgentExecutionConfig{
				Timeout: 300, // 5 minutes
			},
		})
		log.Println("  ✅ Step 2: Security scan agent")

		// ============================================================================
		// Step 3: Code quality review (Agent 2)
		// ============================================================================
		codeReview := wf.CallAgent("codeReview", &workflow.AgentCallArgs{
			Agent: codeReviewAgent.Slug, // Direct slug reference
			Message: workflow.Interpolate(
				"Review code quality for this PR:\n",
				"Title: ", fetchPR.Field("title"), "\n",
				"Description: ", fetchPR.Field("body"), "\n",
				"Changed files: ", fetchPR.Field("changed_files"), "\n",
			),
			Env: map[string]string{
				"GITHUB_TOKEN": workflow.RuntimeSecret("GITHUB_TOKEN"),
				"PR_NUMBER":    workflow.RuntimeEnv("PR_NUMBER"),
			},
			Config: &types.AgentExecutionConfig{
				Timeout: 300,
			},
		})
		log.Println("  ✅ Step 3: Code quality review agent")

		// ============================================================================
		// Step 4: Performance analysis (Agent 3)
		// ============================================================================
		performanceAnalysis := wf.CallAgent("performanceAnalysis", &workflow.AgentCallArgs{
			Agent: performanceAgent.Slug, // Direct slug reference
			Message: workflow.Interpolate(
				"Analyze performance impact of this PR:\n",
				"Changed files: ", fetchPR.Field("changed_files"), "\n",
				"Code changes: ", fetchPR.Field("additions"), " additions, ", fetchPR.Field("deletions"), " deletions\n",
			),
			Env: map[string]string{
				"GITHUB_TOKEN": workflow.RuntimeSecret("GITHUB_TOKEN"),
			},
			Config: &types.AgentExecutionConfig{
				Timeout: 300,
			},
		})
		log.Println("  ✅ Step 4: Performance analysis agent")

		// ============================================================================
		// Step 5: Aggregate results
		// ============================================================================
		aggregateResults := wf.Set("aggregateResults", &workflow.SetArgs{
			Variables: map[string]string{
				"security_status":      securityScan.Field("recommendation").Expression(),
				"code_quality_score":   codeReview.Field("quality_score").Expression(),
				"performance_score":    performanceAnalysis.Field("performance_score").Expression(),
				"security_risk":        securityScan.Field("risk_level").Expression(),
				"performance_concerns": performanceAnalysis.Field("concerns").Expression(),
			},
		})
		log.Println("  ✅ Step 5: Aggregate review results")

		// ============================================================================
		// Step 6: Generate deployment plan (Agent 4)
		// ============================================================================
		deploymentPlan := wf.CallAgent("generateDeploymentPlan", &workflow.AgentCallArgs{
			Agent: devopsAgent.Slug, // Direct slug reference
			Message: workflow.Interpolate(
				"Create deployment plan based on review results:\n",
				"Security: ", aggregateResults.Field("security_status"), " (Risk: ", aggregateResults.Field("security_risk"), ")\n",
				"Code Quality: ", aggregateResults.Field("code_quality_score"), "/100\n",
				"Performance: ", aggregateResults.Field("performance_score"), "/100\n",
				"PR: ", fetchPR.Field("title"), "\n",
			),
			Env: map[string]string{
				"ENVIRONMENT": workflow.RuntimeEnv("DEPLOY_ENV"), // staging/production
			},
			Config: &types.AgentExecutionConfig{
				Timeout: 180,
			},
		})
		log.Println("  ✅ Step 6: Generate deployment plan")

		// ============================================================================
		// Step 7: Execute deployment
		// ============================================================================
		executeDeploy := wf.HttpPost("executeDeploy",
			workflow.RuntimeEnv("DEPLOYMENT_API_URL"),
			map[string]string{
				"Authorization": workflow.Interpolate("Bearer ", workflow.RuntimeSecret("DEPLOY_API_TOKEN")),
			},
			map[string]any{
				"pr_number":   workflow.RuntimeEnv("PR_NUMBER"),
				"plan":        deploymentPlan.Field("plan"),
				"environment": workflow.RuntimeEnv("DEPLOY_ENV"),
			},
		)
		log.Println("  ✅ Step 7: Execute deployment")

		// ============================================================================
		// Step 8: Post-deployment verification (Agent 5)
		// ============================================================================
		verifyDeployment := wf.CallAgent("verifyDeployment", &workflow.AgentCallArgs{
			Agent: qaAgent.Slug, // Direct slug reference
			Message: workflow.Interpolate(
				"Verify deployment health:\n",
				"Deployment ID: ", executeDeploy.Field("deployment_id"), "\n",
				"Environment: ", workflow.RuntimeEnv("DEPLOY_ENV"), "\n",
				"Expected behavior: ", deploymentPlan.Field("expected_metrics"), "\n",
			),
			Env: map[string]string{
				"MONITORING_API_KEY": workflow.RuntimeSecret("MONITORING_API_KEY"),
				"ENVIRONMENT":        workflow.RuntimeEnv("DEPLOY_ENV"),
			},
			Config: &types.AgentExecutionConfig{
				Timeout: 600, // 10 minutes for full verification
			},
		})
		log.Println("  ✅ Step 8: Post-deployment verification")

		// ============================================================================
		// Step 9: Post results to Slack
		// ============================================================================
		notifyTeam := wf.HttpPost("notifyTeam",
			workflow.RuntimeSecret("SLACK_WEBHOOK"),
			nil, // No custom headers
			map[string]any{
				"text": workflow.Interpolate(
					"🚀 Deployment Pipeline Complete for PR #", workflow.RuntimeEnv("PR_NUMBER"), "\n",
					"Security: ", aggregateResults.Field("security_status"), "\n",
					"Quality: ", aggregateResults.Field("code_quality_score"), "/100\n",
					"Performance: ", aggregateResults.Field("performance_score"), "/100\n",
					"Deployment: ", executeDeploy.Field("status"), "\n",
					"Verification: ", verifyDeployment.Field("status"), "\n",
				),
			},
		)
		log.Println("  ✅ Step 9: Notify team on Slack")

		// ============================================================================
		// Pipeline Summary
		// ============================================================================
		log.Println("\n📊 Pipeline Summary:")
		log.Printf("   - Total tasks: %d", len(wf.Args.Tasks))
		log.Printf("   - Agents used: 5 (security, code-review, performance, devops, qa)")
		log.Printf("   - HTTP calls: 4 (fetch PR, deploy, notify)")
		log.Printf("   - Data aggregation: 1")
		log.Println("\n🔐 Runtime secrets required:")
		log.Println("   - GITHUB_TOKEN")
		log.Println("   - DEPLOY_API_TOKEN")
		log.Println("   - MONITORING_API_KEY")
		log.Println("   - SLACK_WEBHOOK")
		log.Println("\n🌍 Runtime env vars required:")
		log.Println("   - PR_NUMBER")
		log.Println("   - DEPLOY_ENV (staging/production)")
		log.Println("   - DEPLOYMENT_API_URL")

		// Avoid unused variable error
		_ = notifyTeam

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error: %v", err)
	}

	log.Println("\n✅ Multi-agent orchestration workflow created successfully!")
	log.Println("🎯 This workflow demonstrates:")
	log.Println("   ✅ Multiple specialized agents")
	log.Println("   ✅ Sequential execution with data flow")
	log.Println("   ✅ Task output chaining")
	log.Println("   ✅ Runtime secrets and env vars")
	log.Println("   ✅ Real-world CI/CD automation")
}
