package workflow

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
)

// =============================================================================
// Benchmark Tests - Proto Conversion
// =============================================================================

// BenchmarkWorkflowToProto_Minimal benchmarks minimal workflow conversion.
func BenchmarkWorkflowToProto_Minimal(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "minimal-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"x": "y"},
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := wf.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkWorkflowToProto_SingleTask benchmarks single task conversion by type.
func BenchmarkWorkflowToProto_SingleTask(b *testing.B) {
	benchmarks := []struct {
		name string
		task *Task
	}{
		{
			name: "SET",
			task: &Task{
				Name: "setTask",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"var1": "value1",
						"var2": "value2",
						"var3": "value3",
					},
				},
			},
		},
		{
			name: "HTTP_CALL",
			task: &Task{
				Name: "httpTask",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					URI:    "https://api.example.com/data",
					Headers: map[string]string{
						"Content-Type":  "application/json",
						"Authorization": "Bearer token",
					},
					TimeoutSeconds: 30,
				},
			},
		},
		{
			name: "GRPC_CALL",
			task: &Task{
				Name: "grpcTask",
				Kind: TaskKindGrpcCall,
				Config: &GrpcCallTaskConfig{
					Service: "MyService",
					Method:  "GetData",
				},
			},
		},
		{
			name: "AGENT_CALL",
			task: &Task{
				Name: "agentTask",
				Kind: TaskKindAgentCall,
				Config: &AgentCallTaskConfig{
					Agent:   "code-reviewer",
					Message: "Please review this code for best practices",
				},
			},
		},
		{
			name: "WAIT",
			task: &Task{
				Name: "waitTask",
				Kind: TaskKindWait,
				Config: &WaitTaskConfig{
					Duration: "5s",
				},
			},
		},
		{
			name: "LISTEN",
			task: &Task{
				Name: "listenTask",
				Kind: TaskKindListen,
				Config: &ListenTaskConfig{
					Event: "user-action",
				},
			},
		},
		{
			name: "RAISE",
			task: &Task{
				Name: "raiseTask",
				Kind: TaskKindRaise,
				Config: &RaiseTaskConfig{
					Error: "CustomError",
				},
			},
		},
	}

	for _, bm := range benchmarks {
		b.Run(bm.name, func(b *testing.B) {
			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "benchmark-workflow",
					Version:   "1.0.0",
				},
				Tasks: []*Task{bm.task},
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := wf.ToProto()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkWorkflowToProto_MultipleTasks benchmarks workflows with varying task counts.
func BenchmarkWorkflowToProto_MultipleTasks(b *testing.B) {
	taskCounts := []int{1, 5, 10, 50, 100, 500}

	for _, count := range taskCounts {
		b.Run(strings.Join([]string{"tasks_", string(rune('0' + count%10))}, ""), func(b *testing.B) {
			// Create workflow with specified number of tasks
			tasks := make([]*Task, count)
			for i := 0; i < count; i++ {
				tasks[i] = &Task{
					Name: "task" + string(rune('0'+i%10)),
					Kind: TaskKindSet,
					Config: &SetTaskConfig{
						Variables: map[string]string{
							"key" + string(rune('0'+i%10)): "value" + string(rune('0'+i%10)),
						},
					},
				}
			}

			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "benchmark-workflow",
					Version:   "1.0.0",
				},
				Tasks: tasks,
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := wf.ToProto()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkWorkflowToProto_WithEnvironmentVariables benchmarks with varying env var counts.
func BenchmarkWorkflowToProto_WithEnvironmentVariables(b *testing.B) {
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

			wf := &Workflow{
				Document: Document{
					DSL:       "1.0.0",
					Namespace: "test",
					Name:      "benchmark-workflow",
					Version:   "1.0.0",
				},
				Tasks: []*Task{
					{
						Name: "task1",
						Kind: TaskKindSet,
						Config: &SetTaskConfig{
							Variables: map[string]string{"x": "y"},
						},
					},
				},
				EnvironmentVariables: envVars,
			}

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				_, err := wf.ToProto()
				if err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkWorkflowToProto_ComplexTasks benchmarks complex task configurations.
func BenchmarkWorkflowToProto_ComplexTasks(b *testing.B) {
	// Create workflow with complex nested structures
	wf := &Workflow{
		Document: Document{
			DSL:         "1.0.0",
			Namespace:   "test",
			Name:        "complex-workflow",
			Version:     "1.0.0",
			Description: strings.Repeat("Complex workflow description ", 10),
		},
		Tasks: []*Task{
			{
				Name: "httpTask",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					URI:    "https://api.example.com/endpoint",
					Headers: map[string]string{
						"Content-Type":  "application/json",
						"Authorization": "Bearer token123",
						"X-Custom-1":    "value1",
						"X-Custom-2":    "value2",
						"X-Custom-3":    "value3",
					},
					TimeoutSeconds: 30,
				},
				ExportAs: "${.}",
			},
			{
				Name: "switchTask",
				Kind: TaskKindSwitch,
				Config: &SwitchTaskConfig{
					Cases: []map[string]interface{}{
						{
							"condition": "${httpTask.status == 200}",
							"then": map[string]interface{}{
								"name": "successTask",
								"kind": "SET",
								"config": map[string]interface{}{
									"variables": map[string]string{
										"result": "success",
									},
								},
							},
						},
						{
							"condition": "${httpTask.status == 500}",
							"then": map[string]interface{}{
								"name": "errorTask",
								"kind": "RAISE",
								"config": map[string]interface{}{
									"error": "ServerError",
								},
							},
						},
					},
				},
			},
			{
				Name: "forTask",
				Kind: TaskKindFor,
				Config: &ForTaskConfig{
					In: "${httpTask.items}",
					Do: []map[string]interface{}{
						{
							"name": "processItem",
							"kind": "AGENT_CALL",
							"config": map[string]interface{}{
								"agent":   "processor",
								"message": "Process ${item}",
							},
						},
					},
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := wf.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Memory Allocation
// =============================================================================

// BenchmarkWorkflowToProto_Allocations benchmarks memory allocations.
func BenchmarkWorkflowToProto_Allocations(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "alloc-test",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:         "GET",
					URI:            "https://api.example.com",
					TimeoutSeconds: 30,
				},
			},
			{
				Name: "task2",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"key1": "value1",
						"key2": "value2",
					},
				},
			},
		},
	}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := wf.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Workflow Creation
// =============================================================================

// BenchmarkWorkflow_Creation benchmarks workflow struct creation.
func BenchmarkWorkflow_Creation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wf := &Workflow{
			Document: Document{
				DSL:       "1.0.0",
				Namespace: "test",
				Name:      "benchmark-workflow",
				Version:   "1.0.0",
			},
			Tasks: []*Task{
				{
					Name: "task1",
					Kind: TaskKindSet,
					Config: &SetTaskConfig{
						Variables: map[string]string{"x": "y"},
					},
				},
			},
		}
		_ = wf
	}
}

// BenchmarkWorkflow_TaskAddition benchmarks adding tasks to workflow.
func BenchmarkWorkflow_TaskAddition(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "benchmark-workflow",
			Version:   "1.0.0",
		},
		Tasks: []*Task{},
	}

	task := &Task{
		Name: "task1",
		Kind: TaskKindSet,
		Config: &SetTaskConfig{
			Variables: map[string]string{"x": "y"},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wf.Tasks = append(wf.Tasks, task)
	}
}

// =============================================================================
// Benchmark Tests - Realistic Workflows
// =============================================================================

// BenchmarkWorkflowToProto_RealisticAPIWorkflow benchmarks a realistic API workflow.
func BenchmarkWorkflowToProto_RealisticAPIWorkflow(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:         "1.0.0",
			Namespace:   "api-workflows",
			Name:        "user-registration",
			Version:     "1.0.0",
			Description: "Complete user registration workflow with validation and notifications",
		},
		Tasks: []*Task{
			{
				Name: "validateInput",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"emailValid":    "${user.email matches '^[^@]+@[^@]+$'}",
						"passwordValid": "${length(user.password) >= 8}",
					},
				},
			},
			{
				Name: "checkValidation",
				Kind: TaskKindSwitch,
				Config: &SwitchTaskConfig{
					Cases: []map[string]interface{}{
						{
							"condition": "${!validateInput.emailValid}",
							"then": map[string]interface{}{
								"name": "raiseInvalidEmail",
								"kind": "RAISE",
								"config": map[string]interface{}{
									"error": "InvalidEmailError",
								},
							},
						},
					},
				},
			},
			{
				Name: "createUser",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					URI:    "https://api.example.com/users",
					Headers: map[string]string{
						"Content-Type": "application/json",
					},
					TimeoutSeconds: 30,
				},
				ExportAs: "${.}",
			},
			{
				Name: "sendWelcomeEmail",
				Kind: TaskKindAgentCall,
				Config: &AgentCallTaskConfig{
					Agent:   "email-sender",
					Message: "Send welcome email to ${user.email}",
				},
			},
			{
				Name: "logSuccess",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					URI:    "https://logging.example.com/events",
					Headers: map[string]string{
						"Content-Type": "application/json",
					},
					TimeoutSeconds: 5,
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := wf.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkWorkflowToProto_RealisticDataPipeline benchmarks a data processing workflow.
func BenchmarkWorkflowToProto_RealisticDataPipeline(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:         "1.0.0",
			Namespace:   "data-pipelines",
			Name:        "daily-analytics",
			Version:     "1.0.0",
			Description: "Daily analytics data processing pipeline",
		},
		Tasks: []*Task{
			{
				Name: "fetchData",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method:         "GET",
					URI:            "https://api.example.com/data",
					TimeoutSeconds: 60,
				},
				ExportAs: "${.}",
			},
			{
				Name: "processRecords",
				Kind: TaskKindFor,
				Config: &ForTaskConfig{
					In: "${fetchData.records}",
					Do: []map[string]interface{}{
						{
							"name": "transform",
							"kind": "AGENT_CALL",
							"config": map[string]interface{}{
								"agent":   "data-transformer",
								"message": "Transform record: ${record}",
							},
						},
					},
				},
			},
			{
				Name: "aggregateResults",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"totalRecords":   "${count(processRecords)}",
						"successCount":   "${count(processRecords.success)}",
						"errorCount":     "${count(processRecords.errors)}",
						"processingTime": "${time.now() - time.start}",
					},
				},
			},
			{
				Name: "saveResults",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					URI:    "https://api.example.com/analytics",
					Headers: map[string]string{
						"Content-Type": "application/json",
					},
					TimeoutSeconds: 30,
				},
			},
		},
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := wf.ToProto()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// =============================================================================
// Benchmark Tests - Parallel Conversion
// =============================================================================

// BenchmarkWorkflowToProto_Parallel benchmarks parallel proto conversion.
func BenchmarkWorkflowToProto_Parallel(b *testing.B) {
	wf := &Workflow{
		Document: Document{
			DSL:       "1.0.0",
			Namespace: "test",
			Name:      "parallel-test",
			Version:   "1.0.0",
		},
		Tasks: []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"x": "y"},
				},
			},
		},
	}

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := wf.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
