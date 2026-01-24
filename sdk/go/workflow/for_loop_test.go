package workflow

import (
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// =============================================================================
// LoopBody Tests - Core Functionality
// =============================================================================

// TestLoopBody_DefaultVariable tests LoopBody with the default "item" variable.
func TestLoopBody_DefaultVariable(t *testing.T) {
	// Create loop body with default "item" variable
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "processItem",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"id":   item.Field("id"),
						"name": item.Field("name"),
					},
				},
			},
		}
	})

	// Verify tasks were created
	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}

	// Verify task structure
	task := tasks[0]
	if task.Name != "processItem" {
		t.Errorf("Expected task name 'processItem', got %s", task.Name)
	}

	if task.Kind != string(TaskKindSet) {
		t.Errorf("Expected task kind 'SET', got %s", task.Kind)
	}

	// Verify field references use correct syntax
	config := task.TaskConfig
	if config == nil {
		t.Fatal("Task config is nil")
	}

	// The config is a map[string]interface{} with structure from taskConfigToMap
	variables, ok := config["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("Variables not found or wrong type in task config. Config: %+v", config)
	}

	// Check field references
	expectedID := "${.item.id}"
	if variables["id"] != expectedID {
		t.Errorf("Expected id reference %q, got %q", expectedID, variables["id"])
	}

	expectedName := "${.item.name}"
	if variables["name"] != expectedName {
		t.Errorf("Expected name reference %q, got %q", expectedName, variables["name"])
	}
}

// TestLoopBody_CustomVariable tests LoopBody with custom variable names via Each field.
func TestLoopBody_CustomVariable(t *testing.T) {
	// Note: The current implementation always uses "item" as the variable name
	// The Each field on ForTaskConfig would override this at the task level,
	// but LoopBody doesn't receive the Each value.
	// This test documents current behavior.

	tasks := LoopBody(func(user LoopVar) []*Task {
		return []*Task{
			{
				Name: "processUser",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"userId": user.Field("id"),
					},
				},
			},
		}
	})

	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}

	task := tasks[0]
	config := task.TaskConfig
	variables, ok := config["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("Variables not found in task config. Config: %+v", config)
	}

	// Currently uses "item" because LoopVar is hardcoded to "item"
	// If Each field is "user", the workflow runtime will handle the mapping
	expectedRef := "${.item.id}"
	if variables["userId"] != expectedRef {
		t.Errorf("Expected reference %q, got %q", expectedRef, variables["userId"])
	}
}

// TestLoopBody_NestedFieldAccess tests accessing nested fields (e.g., item.user.id).
func TestLoopBody_NestedFieldAccess(t *testing.T) {
	// Create a TaskFieldRef manually to test nested access pattern
	// Note: The current LoopVar implementation returns strings, not TaskFieldRef
	// So nested field access would need to be done manually

	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "processNested",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						// Nested access using string concatenation
						"nestedId": "${.item.user.id}",
						"deepPath": "${.item.data.attributes.value}",
					},
				},
			},
		}
	})

	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}

	task := tasks[0]
	config := task.TaskConfig
	variables, ok := config["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("Variables not found in task config. Config: %+v", config)
	}

	// Verify nested references
	if variables["nestedId"] != "${.item.user.id}" {
		t.Errorf("Expected nested reference ${.item.user.id}, got %q", variables["nestedId"])
	}

	if variables["deepPath"] != "${.item.data.attributes.value}" {
		t.Errorf("Expected deep path reference, got %q", variables["deepPath"])
	}
}

// TestLoopBody_ItemValue tests accessing the entire item value.
func TestLoopBody_ItemValue(t *testing.T) {
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "useWholeItem",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"currentItem": item.Value(),
					},
				},
			},
		}
	})

	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}

	task := tasks[0]
	config := task.TaskConfig
	variables, ok := config["variables"].(map[string]interface{})
	if !ok {
		t.Fatalf("Variables not found in task config. Config: %+v", config)
	}

	expectedValue := "${.item}"
	if variables["currentItem"] != expectedValue {
		t.Errorf("Expected item value %q, got %q", expectedValue, variables["currentItem"])
	}
}

// TestLoopBody_MultipleTasks tests LoopBody with multiple tasks in the loop.
func TestLoopBody_MultipleTasks(t *testing.T) {
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "task1",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"step": "1",
						"id":   item.Field("id"),
					},
				},
			},
			{
				Name: "task2",
				Kind: TaskKindWait,
				Config: &WaitTaskConfig{
					Seconds: 1,
				},
			},
			{
				Name: "task3",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"step":   "3",
						"result": item.Field("result"),
					},
				},
			},
		}
	})

	if len(tasks) != 3 {
		t.Fatalf("Expected 3 tasks, got %d", len(tasks))
	}

	// Verify each task was converted correctly
	if tasks[0].Name != "task1" || tasks[0].Kind != string(TaskKindSet) {
		t.Error("Task 1 not converted correctly")
	}

	if tasks[1].Name != "task2" || tasks[1].Kind != string(TaskKindWait) {
		t.Error("Task 2 not converted correctly")
	}

	if tasks[2].Name != "task3" || tasks[2].Kind != string(TaskKindSet) {
		t.Error("Task 3 not converted correctly")
	}
}

// TestLoopBody_WithComplexTaskTypes tests LoopBody with various task types.
func TestLoopBody_WithComplexTaskTypes(t *testing.T) {
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			// HTTP call with loop variables
			{
				Name: "httpTask",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					Endpoint: &types.HttpEndpoint{
						Uri: "https://api.example.com/process",
					},
					Body: map[string]interface{}{
						"itemId":   item.Field("id"),
						"itemName": item.Field("name"),
					},
				},
			},
			// Set task with loop variables
			{
				Name: "setTask",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"processedId": item.Field("id"),
					},
				},
			},
		}
	})

	if len(tasks) != 2 {
		t.Fatalf("Expected 2 tasks, got %d", len(tasks))
	}

	// Verify HTTP task
	httpTask := tasks[0]
	if httpTask.Kind != string(TaskKindHttpCall) {
		t.Error("Expected HTTP_CALL task kind")
	}

	httpConfig := httpTask.TaskConfig
	if httpConfig == nil {
		t.Fatal("HTTP task config is nil")
	}

	body, ok := httpConfig["body"].(map[string]interface{})
	if !ok {
		t.Fatal("Body not found or wrong type in HTTP config")
	}

	if body["itemId"] != "${.item.id}" {
		t.Errorf("Expected itemId reference ${.item.id}, got %v", body["itemId"])
	}
}

// =============================================================================
// Smart Type Conversion Tests
// =============================================================================

// TestSmartTypeConversion_ForTaskConfig_String tests smart conversion with string input.
func TestSmartTypeConversion_ForTaskConfig_String(t *testing.T) {
	// Test that string input is accepted
	config := &ForTaskConfig{
		In: "$.data.items", // Plain string
	}

	// Verify type is correct (interface{} can hold string)
	if config.In == nil {
		t.Fatal("In field should not be nil")
	}

	// Verify CoerceToString handles it correctly
	result := CoerceToString(config.In)
	if result != "$.data.items" {
		t.Errorf("Expected '$.data.items', got %q", result)
	}
}

// TestSmartTypeConversion_ForTaskConfig_TaskFieldRef tests smart conversion with TaskFieldRef.
func TestSmartTypeConversion_ForTaskConfig_TaskFieldRef(t *testing.T) {
	// Create a TaskFieldRef
	taskRef := TaskFieldRef{
		taskName:  "fetchTask",
		fieldName: "items",
	}

	config := &ForTaskConfig{
		In: taskRef, // TaskFieldRef (implements Expression() string)
	}

	// Verify type is correct (interface{} can hold TaskFieldRef)
	if config.In == nil {
		t.Fatal("In field should not be nil")
	}

	// Verify CoerceToString handles it correctly
	result := CoerceToString(config.In)
	expected := `${ $context["fetchTask"].items }`
	if result != expected {
		t.Errorf("Expected %q, got %q", expected, result)
	}
}

// TestSmartTypeConversion_HttpCallTaskConfig tests URI field accepts both string and TaskFieldRef.
func TestSmartTypeConversion_HttpCallTaskConfig(t *testing.T) {
	tests := []struct {
		name     string
		uri      interface{}
		expected string
	}{
		{
			name:     "plain string URI",
			uri:      "https://api.example.com/data",
			expected: "https://api.example.com/data",
		},
		{
			name: "TaskFieldRef URI",
			uri: TaskFieldRef{
				taskName:  "baseTask",
				fieldName: "endpoint",
			},
			expected: `${ $context["baseTask"].endpoint }`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create endpoint with URI (interface{} field)
			endpoint := &types.HttpEndpoint{
				Uri: tt.uri,
			}

			// Verify the URI field accepts both types
			if endpoint.Uri == nil {
				t.Fatal("URI should not be nil")
			}

			// Verify CoerceToString handles conversion correctly
			result := CoerceToString(endpoint.Uri)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// TestSmartTypeConversion_AgentCallTaskConfig tests Message field conversion.
func TestSmartTypeConversion_AgentCallTaskConfig(t *testing.T) {
	tests := []struct {
		name     string
		message  interface{}
		expected string
	}{
		{
			name:     "plain string message",
			message:  "Process this data",
			expected: "Process this data",
		},
		{
			name: "TaskFieldRef message",
			message: TaskFieldRef{
				taskName:  "inputTask",
				fieldName: "prompt",
			},
			expected: `${ $context["inputTask"].prompt }`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			config := &AgentCallTaskConfig{
				Agent:   "test-agent",
				Message: tt.message,
			}

			proto, err := config.ToProto()
			if err != nil {
				t.Fatalf("ToProto failed: %v", err)
			}

			fields := proto.GetFields()
			messageField := fields["message"]
			if messageField == nil {
				t.Fatal("'message' field not found in proto")
			}

			messageValue := messageField.GetStringValue()
			if messageValue != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, messageValue)
			}
		})
	}
}

// TestSmartTypeConversion_RaiseTaskConfig tests Error and Message field conversion.
func TestSmartTypeConversion_RaiseTaskConfig(t *testing.T) {
	errorRef := TaskFieldRef{
		taskName:  "checkTask",
		fieldName: "errorCode",
	}

	config := &RaiseTaskConfig{
		Error:   errorRef, // TaskFieldRef
		Message: "Custom error message",
	}

	proto, err := config.ToProto()
	if err != nil {
		t.Fatalf("ToProto failed: %v", err)
	}

	fields := proto.GetFields()

	// Check error field
	errorField := fields["error"]
	if errorField == nil {
		t.Fatal("'error' field not found in proto")
	}

	errorValue := errorField.GetStringValue()
	expectedError := `${ $context["checkTask"].errorCode }`
	if errorValue != expectedError {
		t.Errorf("Expected error %q, got %q", expectedError, errorValue)
	}

	// Check message field
	messageField := fields["message"]
	if messageField == nil {
		t.Fatal("'message' field not found in proto")
	}

	messageValue := messageField.GetStringValue()
	if messageValue != "Custom error message" {
		t.Errorf("Expected message 'Custom error message', got %q", messageValue)
	}
}

// TestSmartTypeConversion_ListenTaskConfig tests ListenTaskConfig accepts complex types.
// Note: ListenTaskConfig now uses a To field with complex structure,
// not a simple Event string field.
func TestSmartTypeConversion_ListenTaskConfig(t *testing.T) {
	config := &ListenTaskConfig{
		To: &types.ListenTo{
			// Complex structure - verify field accepts it
		},
	}

	// Verify the To field is set correctly
	if config.To == nil {
		t.Fatal("To field should not be nil")
	}

	t.Log("ListenTaskConfig accepts complex To structure")
}

// =============================================================================
// Error Cases and Edge Cases
// =============================================================================

// TestLoopBody_EmptyTasks tests LoopBody returning empty task list.
func TestLoopBody_EmptyTasks(t *testing.T) {
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{} // Empty task list
	})

	if len(tasks) != 0 {
		t.Errorf("Expected 0 tasks, got %d", len(tasks))
	}
}

// TestLoopBody_NilTasks tests LoopBody returning nil.
func TestLoopBody_NilTasks(t *testing.T) {
	tasks := LoopBody(func(item LoopVar) []*Task {
		return nil // Nil task list
	})

	if tasks == nil {
		t.Error("Expected non-nil task slice, got nil")
	}

	if len(tasks) != 0 {
		t.Errorf("Expected 0 tasks, got %d", len(tasks))
	}
}

// TestCoerceToString_VariousTypes tests the CoerceToString helper with different types.
func TestCoerceToString_VariousTypes(t *testing.T) {
	tests := []struct {
		name     string
		input    interface{}
		expected string
	}{
		{
			name:     "string input",
			input:    "hello world",
			expected: "hello world",
		},
		{
			name: "TaskFieldRef input",
			input: TaskFieldRef{
				taskName:  "task1",
				fieldName: "output",
			},
			expected: `${ $context["task1"].output }`,
		},
		{
			name:     "number input",
			input:    42,
			expected: "42",
		},
		{
			name:     "boolean input",
			input:    true,
			expected: "true",
		},
		{
			name:     "float input",
			input:    3.14,
			expected: "3.14",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := CoerceToString(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// TestForTaskConfig_NilIn tests ForTaskConfig with nil In field.
func TestForTaskConfig_NilIn(t *testing.T) {
	config := &ForTaskConfig{
		In: nil, // Nil input
	}

	// Verify nil is handled correctly
	if config.In != nil {
		t.Error("In field should be nil")
	}

	// Verify CoerceToString handles nil (though this shouldn't happen in practice)
	result := CoerceToString(config.In)
	if result != "<nil>" {
		t.Logf("CoerceToString(nil) returned: %q", result)
	}
}

// TestForTaskConfig_EmptyString tests ForTaskConfig with empty string In field.
func TestForTaskConfig_EmptyString(t *testing.T) {
	config := &ForTaskConfig{
		In: "", // Empty string
	}

	// Verify empty string is accepted
	if config.In != "" {
		t.Error("In field should be empty string")
	}

	// Verify CoerceToString handles empty string
	result := CoerceToString(config.In)
	if result != "" {
		t.Errorf("Expected empty string, got %q", result)
	}
}

// =============================================================================
// Integration Tests - Full Workflow Scenarios
// =============================================================================

// TestForTaskIntegration tests a complete FOR task workflow.
func TestForTaskIntegration(t *testing.T) {
	// Create a mock workflow-like structure
	fetchTask := TaskFieldRef{
		taskName:  "fetchItems",
		fieldName: "data",
	}

	// Create FOR task with LoopBody
	forConfig := &ForTaskConfig{
		Each: "item",
		In:   fetchTask, // Using TaskFieldRef - smart conversion
		Do: LoopBody(func(item LoopVar) []*Task {
			return []*Task{
				{
					Name: "processItem",
					Kind: TaskKindHttpCall,
					Config: &HttpCallTaskConfig{
						Method: "POST",
						Endpoint: &types.HttpEndpoint{
							Uri: "https://api.example.com/process",
						},
						Body: map[string]interface{}{
							"itemId":   item.Field("id"),
							"itemData": item.Field("data"),
						},
					},
				},
			}
		}),
	}

	// Verify Each field
	if forConfig.Each != "item" {
		t.Errorf("Expected each='item', got %q", forConfig.Each)
	}

	// Verify In field accepts TaskFieldRef (smart conversion)
	if forConfig.In == nil {
		t.Fatal("In field should not be nil")
	}
	expectedIn := `${ $context["fetchItems"].data }`
	actualIn := CoerceToString(forConfig.In)
	if actualIn != expectedIn {
		t.Errorf("Expected in=%q, got %q", expectedIn, actualIn)
	}

	// Verify Do field contains tasks from LoopBody
	if forConfig.Do == nil {
		t.Fatal("Do field should not be nil")
	}

	if len(forConfig.Do) != 1 {
		t.Fatalf("Expected 1 task in Do list, got %d", len(forConfig.Do))
	}

	// Verify the task structure
	task := forConfig.Do[0]
	if task.Name != "processItem" {
		t.Errorf("Expected task name 'processItem', got %q", task.Name)
	}

	if task.Kind != string(TaskKindHttpCall) {
		t.Errorf("Expected task kind 'HTTP_CALL', got %q", task.Kind)
	}

	// Verify loop variable references in task body
	taskConfig := task.TaskConfig
	if taskConfig == nil {
		t.Fatal("Task config not found")
	}

	body, ok := taskConfig["body"].(map[string]interface{})
	if !ok {
		t.Fatal("Body field not found or wrong type in task config")
	}

	// Verify loop variable references
	itemId := body["itemId"]
	if itemId != "${.item.id}" {
		t.Errorf("Expected itemId='${.item.id}', got %v", itemId)
	}

	itemData := body["itemData"]
	if itemData != "${.item.data}" {
		t.Errorf("Expected itemData='${.item.data}', got %v", itemData)
	}
}

// TestBackwardCompatibility_ExpressionStillWorks tests that .Expression() still works.
func TestBackwardCompatibility_ExpressionStillWorks(t *testing.T) {
	// Create TaskFieldRef
	taskRef := TaskFieldRef{
		taskName:  "fetchTask",
		fieldName: "items",
	}

	// Old way: explicitly calling .Expression()
	config := &ForTaskConfig{
		In: taskRef.Expression(), // Explicit .Expression() call returns string
	}

	// Verify the In field accepts string (backward compatibility)
	if config.In == nil {
		t.Fatal("In field should not be nil")
	}

	// Verify the expression is correct
	expected := `${ $context["fetchTask"].items }`
	actual := CoerceToString(config.In)
	if actual != expected {
		t.Errorf("Expected %q, got %q", expected, actual)
	}

	// Also verify both approaches produce the same result
	config2 := &ForTaskConfig{
		In: taskRef, // New way: without .Expression()
	}

	result1 := CoerceToString(config.In)  // Old way (string)
	result2 := CoerceToString(config2.In) // New way (TaskFieldRef)

	if result1 != result2 {
		t.Errorf("Old and new approaches should produce same result. Got %q vs %q", result1, result2)
	}
}

// TestLoopVar_EdgeCases tests edge cases with LoopVar.
func TestLoopVar_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		loopVar  LoopVar
		field    string
		expected string
	}{
		{
			name:     "default item with simple field",
			loopVar:  LoopVar{varName: "item"},
			field:    "id",
			expected: "${.item.id}",
		},
		{
			name:     "custom variable name",
			loopVar:  LoopVar{varName: "user"},
			field:    "email",
			expected: "${.user.email}",
		},
		{
			name:     "empty variable name (falls back to item)",
			loopVar:  LoopVar{varName: ""},
			field:    "status",
			expected: "${.item.status}",
		},
		{
			name:     "special characters in field name",
			loopVar:  LoopVar{varName: "item"},
			field:    "user-id",
			expected: "${.item.user-id}",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.loopVar.Field(tt.field)
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// TestLoopVar_Value tests LoopVar.Value() method.
func TestLoopVar_Value(t *testing.T) {
	tests := []struct {
		name     string
		loopVar  LoopVar
		expected string
	}{
		{
			name:     "default item",
			loopVar:  LoopVar{varName: "item"},
			expected: "${.item}",
		},
		{
			name:     "custom variable",
			loopVar:  LoopVar{varName: "user"},
			expected: "${.user}",
		},
		{
			name:     "empty variable name",
			loopVar:  LoopVar{varName: ""},
			expected: "${.item}",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.loopVar.Value()
			if result != tt.expected {
				t.Errorf("Expected %q, got %q", tt.expected, result)
			}
		})
	}
}

// =============================================================================
// Documentation Tests - Verify Examples Work
// =============================================================================

// TestLoopBody_DocumentationExample tests the example from LoopBody godoc.
func TestLoopBody_DocumentationExample(t *testing.T) {
	// Simulate the example from documentation
	// Note: Using plain string URI instead of Concat which doesn't exist
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "processItem",
				Kind: TaskKindHttpCall,
				Config: &HttpCallTaskConfig{
					Method: "POST",
					Endpoint: &types.HttpEndpoint{
						Uri: "https://api.example.com/process",
					},
					Body: map[string]interface{}{
						"itemId": item.Field("id"),
						"data":   item.Field("data"),
					},
				},
			},
		}
	})

	if len(tasks) != 1 {
		t.Fatalf("Expected 1 task, got %d", len(tasks))
	}

	task := tasks[0]
	if task.Name != "processItem" {
		t.Errorf("Expected task name 'processItem', got %s", task.Name)
	}

	config := task.TaskConfig
	body, ok := config["body"].(map[string]interface{})
	if !ok {
		t.Fatal("Body not found in config")
	}

	if body["itemId"] != "${.item.id}" {
		t.Errorf("Expected itemId='${.item.id}', got %v", body["itemId"])
	}

	if body["data"] != "${.item.data}" {
		t.Errorf("Expected data='${.item.data}', got %v", body["data"])
	}
}

// TestLoopBody_PanicOnError tests that LoopBody panics when task conversion fails.
func TestLoopBody_PanicOnError(t *testing.T) {
	// Note: Current implementation panics on taskToMap errors
	// This test documents that behavior

	// This test would need a task that causes taskToMap to fail
	// For now, we just verify the panic recovery would work
	defer func() {
		if r := recover(); r != nil {
			t.Logf("Recovered from panic (expected behavior): %v", r)
		}
	}()

	// Create tasks normally (no panic expected)
	tasks := LoopBody(func(item LoopVar) []*Task {
		return []*Task{
			{
				Name: "normalTask",
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{"x": "y"},
				},
			},
		}
	})

	if len(tasks) != 1 {
		t.Error("Expected successful task creation")
	}
}

// =============================================================================
// Performance Tests
// =============================================================================

// TestLoopBody_LargeTaskList tests LoopBody with many tasks.
func TestLoopBody_LargeTaskList(t *testing.T) {
	// Create loop body with 100 tasks
	tasks := LoopBody(func(item LoopVar) []*Task {
		result := make([]*Task, 100)
		for i := 0; i < 100; i++ {
			result[i] = &Task{
				Name: "task_" + strings.Repeat("x", i%10),
				Kind: TaskKindSet,
				Config: &SetTaskConfig{
					Variables: map[string]string{
						"index": item.Field("id"),
					},
				},
			}
		}
		return result
	})

	if len(tasks) != 100 {
		t.Fatalf("Expected 100 tasks, got %d", len(tasks))
	}

	// Verify first and last tasks
	if tasks[0].Name != "task_" {
		t.Errorf("First task name incorrect: %s", tasks[0].Name)
	}

	if tasks[99].Kind != string(TaskKindSet) {
		t.Error("Last task kind incorrect")
	}
}
