package agent

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/skillref"
)

// mockEnvContext implements the environment.Context interface for testing
type mockEnvContext struct{}

// =============================================================================
// Benchmark Tests - Agent Creation
// =============================================================================

// BenchmarkAgent_New_Minimal benchmarks minimal agent creation.
func BenchmarkAgent_New_Minimal(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := New(nil, "test-agent", &AgentArgs{
			Instructions: "This is a test agent for benchmarking minimal agent creation",
		})
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAgent_New_Complete benchmarks complete agent creation.
func BenchmarkAgent_New_Complete(b *testing.B) {
	ctx := &mockEnvContext{}

	// Use skillref to reference platform skills (SDK doesn't create skills)
	skillRef := skillref.Platform("skill1")

	env1, _ := environment.New(ctx, "API_KEY", &environment.VariableArgs{
		IsSecret: true,
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		agent, err := New(nil, "complete-agent", &AgentArgs{
			Description:  "Complete agent with all features",
			IconUrl:      "https://example.com/icon.png",
			Instructions: "Complete instructions for benchmarking agent creation with all features",
		})
		if err != nil {
			b.Fatal(err)
		}
		agent.AddSkillRef(skillRef)
		agent.AddEnvironmentVariable(*env1)
	}
}

// =============================================================================
// Benchmark Tests - Proto Conversion
// =============================================================================

// BenchmarkAgentToProto_Minimal benchmarks minimal agent proto conversion.
func BenchmarkAgentToProto_Minimal(b *testing.B) {
	agent, _ := New(nil, "minimal-agent", &AgentArgs{
		Instructions: "Minimal agent for benchmarking proto conversion performance",
	})

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := agent.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAgentToProto_WithSkillRefs benchmarks agent with varying skill ref counts.
func BenchmarkAgentToProto_WithSkillRefs(b *testing.B) {
	skillCounts := []int{1, 5, 10, 50}

	for _, count := range skillCounts {
		b.Run(strings.Join([]string{"skillrefs_", string(rune('0' + count%10))}, ""), func(b *testing.B) {
			agent, _ := New(nil, "benchmark-agent", &AgentArgs{
				Instructions: "Agent with multiple skill refs for benchmarking proto conversion",
			})

			// Add skill references (SDK references skills, doesn't create them)
			for i := 0; i < count; i++ {
				agent.AddSkillRef(skillref.Platform("skill-" + string(rune('0'+i%10))))
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := agent.ToProto()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkAgentToProto_WithEnvironmentVariables benchmarks agent with varying env var counts.
func BenchmarkAgentToProto_WithEnvironmentVariables(b *testing.B) {
	ctx := &mockEnvContext{}
	envVarCounts := []int{0, 5, 10, 50, 100}

	for _, count := range envVarCounts {
		b.Run(strings.Join([]string{"envvars_", string(rune('0' + count%10))}, ""), func(b *testing.B) {
			// Create environment variables
			envVars := make([]environment.Variable, count)
			for i := 0; i < count; i++ {
				env, _ := environment.New(ctx, "ENV_VAR_"+string(rune('A'+i%26)), &environment.VariableArgs{
					DefaultValue: "value" + string(rune('0'+i%10)),
					IsSecret:     i%2 == 0,
				})
				envVars[i] = *env
			}

			agent, _ := New(nil, "benchmark-agent", &AgentArgs{
				Instructions: "Agent with multiple environment variables for benchmarking proto conversion",
			})
			agent.AddEnvironmentVariables(envVars...)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := agent.ToProto()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkAgentToProto_Complete benchmarks complete agent with all features.
func BenchmarkAgentToProto_Complete(b *testing.B) {
	ctx := &mockEnvContext{}

	agent, _ := New(nil, "complete-benchmark-agent", &AgentArgs{
		Description:  "Complete agent with all features for comprehensive benchmarking",
		IconUrl:      "https://example.com/icon.png",
		Instructions: strings.Repeat("Detailed instructions for benchmarking. ", 20),
	})

	// Add 10 skill refs
	for i := 0; i < 10; i++ {
		agent.AddSkillRef(skillref.Platform("skill-" + string(rune('0'+i))))
	}

	// Add 20 environment variables
	for i := 0; i < 20; i++ {
		env, _ := environment.New(ctx, "ENV_VAR_"+string(rune('A'+i%26)), &environment.VariableArgs{
			DefaultValue: "value" + string(rune('0'+i%10)),
		})
		agent.AddEnvironmentVariable(*env)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := agent.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Memory Allocation
// =============================================================================

// BenchmarkAgentToProto_Allocations benchmarks memory allocations.
func BenchmarkAgentToProto_Allocations(b *testing.B) {
	agent, _ := New(nil, "alloc-test-agent", &AgentArgs{
		Instructions: "Agent for benchmarking memory allocations during proto conversion",
	})
	agent.AddSkillRef(skillref.Platform("skill1"))

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := agent.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Realistic Agents
// =============================================================================

// BenchmarkAgentToProto_RealisticCodeReviewer benchmarks a realistic code reviewer agent.
func BenchmarkAgentToProto_RealisticCodeReviewer(b *testing.B) {
	ctx := &mockEnvContext{}

	agent, _ := New(nil, "code-reviewer-pro", &AgentArgs{
		Description: "Professional code reviewer with comprehensive analysis capabilities",
		IconUrl:     "https://example.com/code-reviewer-icon.png",
		Instructions: strings.Join([]string{
			"You are an expert code reviewer. Your responsibilities:",
			"1. Analyze code for best practices and patterns",
			"2. Identify security vulnerabilities and risks",
			"3. Suggest performance optimizations",
			"4. Ensure code maintainability and readability",
			"5. Check for proper error handling",
			"Always provide constructive feedback with specific examples.",
		}, "\n"),
	})

	// Add skill references (SDK references skills, doesn't create them)
	agent.AddSkillRef(skillref.Platform("code-analysis"))
	agent.AddSkillRef(skillref.Platform("security-review"))
	agent.AddSkillRef(skillref.Platform("performance-analysis"))

	// Add environment variables
	apiKey, _ := environment.New(ctx, "GITHUB_TOKEN", &environment.VariableArgs{
		IsSecret: true,
	})
	repo, _ := environment.New(ctx, "REPOSITORY", &environment.VariableArgs{
		DefaultValue: "myorg/myrepo",
	})
	agent.AddEnvironmentVariables(*apiKey, *repo)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := agent.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAgentToProto_RealisticDataAnalyst benchmarks a realistic data analyst agent.
func BenchmarkAgentToProto_RealisticDataAnalyst(b *testing.B) {
	ctx := &mockEnvContext{}

	agent, _ := New(nil, "data-analyst-pro", &AgentArgs{
		Description:  "Professional data analyst with SQL and visualization expertise",
		Instructions: "Analyze data, create insightful visualizations, and generate comprehensive reports",
	})

	// Add skill references
	agent.AddSkillRef(skillref.Platform("sql-queries"))
	agent.AddSkillRef(skillref.Platform("data-visualization"))

	// Add environment variable
	dbCreds, _ := environment.New(ctx, "DB_CONNECTION_STRING", &environment.VariableArgs{
		IsSecret: true,
	})
	agent.AddEnvironmentVariable(*dbCreds)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := agent.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Parallel Conversion
// =============================================================================

// BenchmarkAgentToProto_Parallel benchmarks parallel proto conversion.
func BenchmarkAgentToProto_Parallel(b *testing.B) {
	agent, _ := New(nil, "parallel-test-agent", &AgentArgs{
		Instructions: "Agent for benchmarking parallel proto conversion",
	})

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := agent.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}

// BenchmarkAgentToProto_ParallelComplex benchmarks parallel conversion with complex agent.
func BenchmarkAgentToProto_ParallelComplex(b *testing.B) {
	agent, _ := New(nil, "parallel-complex-agent", &AgentArgs{
		Instructions: "Complex agent for benchmarking parallel proto conversion",
	})

	// Add 10 skill refs
	for i := 0; i < 10; i++ {
		agent.AddSkillRef(skillref.Platform("skill-" + string(rune('0'+i))))
	}

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := agent.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
