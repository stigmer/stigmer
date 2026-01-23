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
		_, err := New(nil,
			WithName("test-agent"),
			WithInstructions("This is a test agent for benchmarking minimal agent creation"),
		)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkAgent_New_Complete benchmarks complete agent creation.
func BenchmarkAgent_New_Complete(b *testing.B) {
	skill1, _ := skill.New(
		skill.WithName("skill1"),
		skill.WithMarkdown("# Skill 1"),
	)

	env1, _ := environment.New(
		environment.WithName("API_KEY"),
		environment.WithSecret(true),
	)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := New(nil,
			WithName("complete-agent"),
			WithSlug("complete-agent"),
			WithDescription("Complete agent with all features"),
			WithIconURL("https://example.com/icon.png"),
			WithInstructions("Complete instructions for benchmarking agent creation with all features"),
			WithSkills(*skill1),
			WithEnvironmentVariables(env1),
		)
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Proto Conversion
// =============================================================================

// BenchmarkAgentToProto_Minimal benchmarks minimal agent proto conversion.
func BenchmarkAgentToProto_Minimal(b *testing.B) {
	agent, _ := New(nil,
		WithName("minimal-agent"),
		WithInstructions("Minimal agent for benchmarking proto conversion performance"),
	)

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
				s, _ := skill.New(
					skill.WithName("skill"+string(rune('0'+i%10))),
					skill.WithMarkdown("# Skill "+string(rune('0'+i%10))),
				)
				skills[i] = *s
			}

			agent, _ := New(nil,
				WithName("benchmark-agent"),
				WithInstructions("Agent with multiple skills for benchmarking proto conversion"),
				WithSkills(skills...),
			)

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

			agent, _ := New(nil,
				WithName("benchmark-agent"),
				WithInstructions("Agent with multiple environment variables for benchmarking proto conversion"),
				WithEnvironmentVariables(envVars...),
			)

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
		s, _ := skill.New(
			skill.WithName("skill"+string(rune('0'+i))),
			skill.WithMarkdown("# Skill "+string(rune('0'+i))),
		)
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

	agent, _ := New(nil,
		WithName("complete-benchmark-agent"),
		WithSlug("complete-benchmark-agent"),
		WithDescription("Complete agent with all features for comprehensive benchmarking"),
		WithIconURL("https://example.com/icon.png"),
		WithInstructions(strings.Repeat("Detailed instructions for benchmarking. ", 20)),
		WithSkills(skills...),
		WithEnvironmentVariables(envVars...),
	)

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
	skill1, _ := skill.New(
		skill.WithName("skill1"),
		skill.WithMarkdown("# Skill 1"),
	)

	agent, _ := New(nil,
		WithName("alloc-test-agent"),
		WithInstructions("Agent for benchmarking memory allocations during proto conversion"),
		WithSkills(*skill1),
	)

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
	codeAnalysisSkill, _ := skill.New(
		skill.WithName("code-analysis"),
		skill.WithMarkdown("# Code Analysis\nAnalyze code quality and best practices"),
	)

	securitySkill, _ := skill.New(
		skill.WithName("security-review"),
		skill.WithMarkdown("# Security Review\nIdentify security vulnerabilities"),
	)

	performanceSkill, _ := skill.New(
		skill.WithName("performance-analysis"),
		skill.WithMarkdown("# Performance Analysis\nAnalyze code performance"),
	)

	// Create environment variables
	apiKey, _ := environment.New(
		environment.WithName("GITHUB_TOKEN"),
		environment.WithSecret(true),
	)

	repo, _ := environment.New(
		environment.WithName("REPOSITORY"),
		environment.WithDefaultValue("myorg/myrepo"),
	)

	agent, _ := New(nil,
		WithName("code-reviewer-pro"),
		WithSlug("code-reviewer-pro"),
		WithDescription("Professional code reviewer with comprehensive analysis capabilities"),
		WithIconURL("https://example.com/code-reviewer-icon.png"),
		WithInstructions(strings.Join([]string{
			"You are an expert code reviewer. Your responsibilities:",
			"1. Analyze code for best practices and patterns",
			"2. Identify security vulnerabilities and risks",
			"3. Suggest performance optimizations",
			"4. Ensure code maintainability and readability",
			"5. Check for proper error handling",
			"Always provide constructive feedback with specific examples.",
		}, "\n")),
		WithSkills(*codeAnalysisSkill, *securitySkill, *performanceSkill),
		WithEnvironmentVariables(apiKey, repo),
	)

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
	sqlSkill, _ := skill.New(
		skill.WithName("sql-queries"),
		skill.WithMarkdown("# SQL Queries\nWrite and optimize SQL queries"),
	)

	dataVizSkill, _ := skill.New(
		skill.WithName("data-visualization"),
		skill.WithMarkdown("# Data Visualization\nCreate meaningful data visualizations"),
	)

	// Create environment variables
	dbCreds, _ := environment.New(
		environment.WithName("DB_CONNECTION_STRING"),
		environment.WithSecret(true),
	)

	agent, _ := New(nil,
		WithName("data-analyst-pro"),
		WithDescription("Professional data analyst with SQL and visualization expertise"),
		WithInstructions("Analyze data, create insightful visualizations, and generate comprehensive reports"),
		WithSkills(*sqlSkill, *dataVizSkill),
		WithEnvironmentVariables(dbCreds),
	)

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
	agent, _ := New(nil,
		WithName("parallel-test-agent"),
		WithInstructions("Agent for benchmarking parallel proto conversion"),
	)

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
		s, _ := skill.New(
			skill.WithName("skill"+string(rune('0'+i))),
			skill.WithMarkdown("# Skill "+string(rune('0'+i))),
		)
		skills[i] = *s
	}

	agent, _ := New(nil,
		WithName("parallel-complex-agent"),
		WithInstructions("Complex agent for benchmarking parallel proto conversion"),
		WithSkills(skills...),
	)

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := agent.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
