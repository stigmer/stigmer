package workflow

import (
	"fmt"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// =============================================================================
// Benchmark Tests - Proto Conversion
// =============================================================================

// createTestWorkflow creates a workflow for benchmarking using the unified pattern.
func createTestWorkflow(namespace, name string, tasks []*Task) *Workflow {
	wf := &Workflow{
		Name: name,
		Slug: name,
		Args: &WorkflowArgs{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: namespace,
				Name:      name,
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{},
		},
	}

	// Convert and add tasks
	for _, task := range tasks {
		protoTask, _ := convertTask(task)
		wf.Args.Tasks = append(wf.Args.Tasks, protoTask)
	}

	return wf
}

// BenchmarkWorkflowToProto_Minimal benchmarks minimal workflow conversion.
func BenchmarkWorkflowToProto_Minimal(b *testing.B) {
	tasks := []*Task{
		{
			Name: "task1",
			Kind: TaskKindSet,
			Config: &SetTaskConfig{
				Variables: map[string]string{"x": "y"},
			},
		},
	}
	wf := createTestWorkflow("test", "minimal-workflow", tasks)

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
					Endpoint: &types.HttpEndpoint{
						Uri: "https://api.example.com/data",
					},
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
					Seconds: 5,
				},
			},
		},
		{
			name: "LISTEN",
			task: &Task{
				Name: "listenTask",
				Kind: TaskKindListen,
				Config: &ListenTaskConfig{
					To: &types.ListenTo{
						Mode: "one",
					},
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
			wf := createTestWorkflow("test", "benchmark-workflow", []*Task{bm.task})

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
	taskCounts := []int{1, 5, 10, 50, 100}

	for _, count := range taskCounts {
		b.Run(fmt.Sprintf("tasks_%d", count), func(b *testing.B) {
			// Create tasks
			tasks := make([]*Task, count)
			for i := 0; i < count; i++ {
				tasks[i] = &Task{
					Name: fmt.Sprintf("task%d", i),
					Kind: TaskKindSet,
					Config: &SetTaskConfig{
						Variables: map[string]string{
							fmt.Sprintf("key%d", i): fmt.Sprintf("value%d", i),
						},
					},
				}
			}

			wf := createTestWorkflow("test", "benchmark-workflow", tasks)

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
	tasks := []*Task{
		{
			Name: "httpTask",
			Kind: TaskKindHttpCall,
			Config: &HttpCallTaskConfig{
				Method: "POST",
				Endpoint: &types.HttpEndpoint{
					Uri: "https://api.example.com/endpoint",
				},
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
				Cases: []*types.SwitchCase{
					{
						Name: "case1",
						When: "${httpTask.status == 200}",
						Then: "successTask",
					},
					{
						Name: "case2",
						When: "${httpTask.status == 500}",
						Then: "errorTask",
					},
				},
			},
		},
		{
			Name: "forTask",
			Kind: TaskKindFor,
			Config: &ForTaskConfig{
				Each: "item",
				In:   "${httpTask.items}",
				Do:   nil, // Simplified for benchmark
			},
		},
	}

	// Create workflow with description
	wf := createTestWorkflow("test", "complex-workflow", tasks)
	wf.Args.Description = strings.Repeat("Complex workflow description ", 10)

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
	tasks := []*Task{
		{
			Name: "task1",
			Kind: TaskKindHttpCall,
			Config: &HttpCallTaskConfig{
				Method: "GET",
				Endpoint: &types.HttpEndpoint{
					Uri: "https://api.example.com",
				},
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
	}

	wf := createTestWorkflow("test", "alloc-test", tasks)

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

// BenchmarkWorkflow_Creation benchmarks workflow struct creation via New().
func BenchmarkWorkflow_Creation(b *testing.B) {
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		wf, err := New(nil, "test/benchmark-workflow", nil)
		if err != nil {
			b.Fatal(err)
		}
		_ = wf
	}
}

// BenchmarkWorkflow_TaskAddition benchmarks adding tasks to workflow.
func BenchmarkWorkflow_TaskAddition(b *testing.B) {
	wf, err := New(nil, "test/benchmark-workflow", nil)
	if err != nil {
		b.Fatal(err)
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
		// Note: This will add many tasks to the same workflow
		// For pure AddTask benchmark, we accept this
		protoTask, _ := convertTask(task)
		wf.Args.Tasks = append(wf.Args.Tasks, protoTask)
	}
}

// =============================================================================
// Benchmark Tests - Realistic Workflows
// =============================================================================

// BenchmarkWorkflowToProto_RealisticAPIWorkflow benchmarks a realistic API workflow.
func BenchmarkWorkflowToProto_RealisticAPIWorkflow(b *testing.B) {
	tasks := []*Task{
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
				Cases: []*types.SwitchCase{
					{
						Name: "invalidEmail",
						When: "${!validateInput.emailValid}",
						Then: "raiseInvalidEmail",
					},
				},
			},
		},
		{
			Name: "createUser",
			Kind: TaskKindHttpCall,
			Config: &HttpCallTaskConfig{
				Method: "POST",
				Endpoint: &types.HttpEndpoint{
					Uri: "https://api.example.com/users",
				},
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
				Endpoint: &types.HttpEndpoint{
					Uri: "https://logging.example.com/events",
				},
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
				TimeoutSeconds: 5,
			},
		},
	}

	wf := createTestWorkflow("api-workflows", "user-registration", tasks)
	wf.Args.Description = "Complete user registration workflow with validation and notifications"

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
	tasks := []*Task{
		{
			Name: "fetchData",
			Kind: TaskKindHttpCall,
			Config: &HttpCallTaskConfig{
				Method: "GET",
				Endpoint: &types.HttpEndpoint{
					Uri: "https://api.example.com/data",
				},
				TimeoutSeconds: 60,
			},
			ExportAs: "${.}",
		},
		{
			Name: "processRecords",
			Kind: TaskKindFor,
			Config: &ForTaskConfig{
				Each: "record",
				In:   "${fetchData.records}",
				Do:   nil, // Simplified for benchmark
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
				Endpoint: &types.HttpEndpoint{
					Uri: "https://api.example.com/analytics",
				},
				Headers: map[string]string{
					"Content-Type": "application/json",
				},
				TimeoutSeconds: 30,
			},
		},
	}

	wf := createTestWorkflow("data-pipelines", "daily-analytics", tasks)
	wf.Args.Description = "Daily analytics data processing pipeline"

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
	tasks := []*Task{
		{
			Name: "task1",
			Kind: TaskKindSet,
			Config: &SetTaskConfig{
				Variables: map[string]string{"x": "y"},
			},
		},
	}

	wf := createTestWorkflow("test", "parallel-test", tasks)

	b.RunParallel(func(pb *testing.PB) {
		for pb.Next() {
			_, err := wf.ToProto()
			if err != nil {
				b.Fatal(err)
			}
		}
	})
}
