package agent

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/skill"
)

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
	skill1, _ := skill.New("skill1", &skill.SkillArgs{
		MarkdownContent: "# Skill 1",
	})

	env1, _ := environment.New(
		environment.WithName("API_KEY"),
		environment.WithSecret(true),
	)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		agent, err := New(nil, "complete-agent", &AgentArgs{
			Description: "Complete agent with all features",
			IconUrl:     "https://example.com/icon.png",
			Instructions: "Complete instructions for benchmarking agent creation with all features",
		})
		if err != nil {
			b.Fatal(err)
		}
		agent.AddSkill(*skill1)
		agent.AddEnvironmentVariable(env1)
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

// BenchmarkAgentToProto_WithSkills benchmarks agent with varying skill counts.
func BenchmarkAgentToProto_WithSkills(b *testing.B) {
	skillCounts := []int{1, 5, 10, 50}

		for _, count := range skillCounts {
		b.Run(strings.Join([]string{"skills_", string(rune('0' + count%10))}, ""), func(b *testing.B) {
			// Create skills
			skills := make([]skill.Skill, count)
			for i := 0; i < count; i++ {
				s, _ := skill.New("skill"+string(rune('0'+i%10)), &skill.SkillArgs{
					MarkdownContent: "# Skill " + string(rune('0'+i%10)),
				})
				skills[i] = *s
			}

			agent, _ := New(nil, "benchmark-agent", &AgentArgs{
				Instructions: "Agent with multiple skills for benchmarking proto conversion",
			})
			agent.AddSkills(skills...)

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
	envVarCounts := []int{0, 5, 10, 50, 100}

	for _, count := range envVarCounts {
		b.Run(strings.Join([]string{"envvars_", string(rune('0' + count%10))}, ""), func(b *testing.B) {
			// Create environment variables
			envVars := make([]environment.Variable, count)
			for i := 0; i < count; i++ {
				env, _ := environment.New(
					environment.WithName("ENV_VAR_"+string(rune('0'+i%10))),
					environment.WithDefaultValue("value"+string(rune('0'+i%10))),
					environment.WithSecret(i%2 == 0),
				)
				envVars[i] = env
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
	// Create 10 skills
	skills := make([]skill.Skill, 10)
	for i := 0; i < 10; i++ {
		s, _ := skill.New("skill"+string(rune('0'+i)), &skill.SkillArgs{
			MarkdownContent: "# Skill " + string(rune('0'+i)),
		})
		skills[i] = *s
	}

	// Create 20 environment variables
	envVars := make([]environment.Variable, 20)
	for i := 0; i < 20; i++ {
		env, _ := environment.New(
			environment.WithName("ENV_VAR_"+string(rune('0'+i%10))),
			environment.WithDefaultValue("value"+string(rune('0'+i%10))),
		)
		envVars[i] = env
	}

	agent, _ := New(nil, "complete-benchmark-agent", &AgentArgs{
		Description:  "Complete agent with all features for comprehensive benchmarking",
		IconUrl:      "https://example.com/icon.png",
		Instructions: strings.Repeat("Detailed instructions for benchmarking. ", 20),
	})
	agent.AddSkills(skills...)
	agent.AddEnvironmentVariables(envVars...)

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
	skill1, _ := skill.New("skill1", &skill.SkillArgs{
		MarkdownContent: "# Skill 1",
	})

	agent, _ := New(nil, "alloc-test-agent", &AgentArgs{
		Instructions: "Agent for benchmarking memory allocations during proto conversion",
	})
	agent.AddSkill(*skill1)

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
	// Create skills
	codeAnalysisSkill, _ := skill.New("code-analysis", &skill.SkillArgs{
		MarkdownContent: "# Code Analysis\nAnalyze code quality and best practices",
	})

	securitySkill, _ := skill.New("security-review", &skill.SkillArgs{
		MarkdownContent: "# Security Review\nIdentify security vulnerabilities",
	})

	performanceSkill, _ := skill.New("performance-analysis", &skill.SkillArgs{
		MarkdownContent: "# Performance Analysis\nAnalyze code performance",
	})

	// Create environment variables
	apiKey, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	repo, _ := environment.New(
		environment.WithName("REPOSITORY"),
		environment.WithDefaultValue("myorg/myrepo"),
	)

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
	agent.AddSkills(*codeAnalysisSkill, *securitySkill, *performanceSkill)
	agent.AddEnvironmentVariables(apiKey, repo)

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
	// Create skills
	sqlSkill, _ := skill.New("sql-queries", &skill.SkillArgs{
		MarkdownContent: "# SQL Queries\nWrite and optimize SQL queries",
	})

	dataVizSkill, _ := skill.New("data-visualization", &skill.SkillArgs{
		MarkdownContent: "# Data Visualization\nCreate meaningful data visualizations",
	})

	// Create environment variables
	dbCreds, _ := environment.New(
		environment.WithName("DB_CONNECTION_STRING"),
		environment.WithSecret(true),
	)

	agent, _ := New(nil, "data-analyst-pro", &AgentArgs{
		Description:  "Professional data analyst with SQL and visualization expertise",
		Instructions: "Analyze data, create insightful visualizations, and generate comprehensive reports",
	})
	agent.AddSkills(*sqlSkill, *dataVizSkill)
	agent.AddEnvironmentVariable(dbCreds)

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
	// Create complex agent
	skills := make([]skill.Skill, 10)
	for i := 0; i < 10; i++ {
		s, _ := skill.New("skill"+string(rune('0'+i)), &skill.SkillArgs{
			MarkdownContent: "# Skill " + string(rune('0'+i)),
		})
		skills[i] = *s
	}

	agent, _ := New(nil, "parallel-complex-agent", &AgentArgs{
		Instructions: "Complex agent for benchmarking parallel proto conversion",
	})
	agent.AddSkills(skills...)

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := agent.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
