package workflow

import (
	"testing"
)

// TestField_AutoExport verifies that calling Field() automatically exports the task.
func TestField_AutoExport(t *testing.T) {
	// Create a task without export
	task := &Task{
		Name:     "fetchData",
		Kind:     TaskKindHttpCall,
		ExportAs: "", // No export initially
	}

	// Verify no export set initially
	if task.ExportAs != "" {
		t.Fatalf("Expected no export initially, got: %s", task.ExportAs)
	}

	// Call Field() to create a reference
	ref := task.Field("title")

	// Verify auto-export was set
	if task.ExportAs != "${.}" {
		t.Errorf("Expected auto-export to be set to '${.}', got: %s", task.ExportAs)
	}

	// Verify the field reference is correct
	expectedExpr := "${ $context.fetchData.title }"
	if ref.Expression() != expectedExpr {
		t.Errorf("Expected expression %s, got: %s", expectedExpr, ref.Expression())
	}
}

// TestField_PreservesExistingExport verifies that calling Field() doesn't override existing exports.
func TestField_PreservesExistingExport(t *testing.T) {
	// Create a task with custom export
	customExport := "${ .specificField }"
	task := &Task{
		Name:     "processData",
		Kind:     TaskKindSet,
		ExportAs: customExport, // Custom export already set
	}

	// Call Field() to create a reference
	_ = task.Field("result")

	// Verify custom export was preserved
	if task.ExportAs != customExport {
		t.Errorf("Expected custom export %s to be preserved, got: %s", customExport, task.ExportAs)
	}
}

// TestField_MultipleCallsIdempotent verifies that calling Field() multiple times is safe.
func TestField_MultipleCallsIdempotent(t *testing.T) {
	// Create a task without export
	task := &Task{
		Name:     "fetchData",
		Kind:     TaskKindHttpCall,
		ExportAs: "",
	}

	// Call Field() multiple times
	ref1 := task.Field("title")
	ref2 := task.Field("body")
	ref3 := task.Field("status")

	// Verify export was set once and remains the same
	if task.ExportAs != "${.}" {
		t.Errorf("Expected export to be '${.}', got: %s", task.ExportAs)
	}

	// Verify all references work correctly
	expectedExprs := []string{
		"${ $context.fetchData.title }",
		"${ $context.fetchData.body }",
		"${ $context.fetchData.status }",
	}

	refs := []TaskFieldRef{ref1, ref2, ref3}
	for i, ref := range refs {
		if ref.Expression() != expectedExprs[i] {
			t.Errorf("Reference %d: expected %s, got: %s", i, expectedExprs[i], ref.Expression())
		}
	}
}

// TestField_TaskNameCorrect verifies that TaskName() returns the correct task name.
func TestField_TaskNameCorrect(t *testing.T) {
	task := &Task{
		Name: "myTask",
		Kind: TaskKindHttpCall,
	}

	ref := task.Field("someField")

	if ref.TaskName() != "myTask" {
		t.Errorf("Expected task name 'myTask', got: %s", ref.TaskName())
	}
}

// TestField_FieldNameCorrect verifies that FieldName() returns the correct field name.
func TestField_FieldNameCorrect(t *testing.T) {
	task := &Task{
		Name: "myTask",
		Kind: TaskKindHttpCall,
	}

	ref := task.Field("myField")

	if ref.FieldName() != "myField" {
		t.Errorf("Expected field name 'myField', got: %s", ref.FieldName())
	}
}

// TestExportAll_StillWorks verifies that manual ExportAll() still works.
func TestExportAll_StillWorks(t *testing.T) {
	task := &Task{
		Name:     "fetchData",
		Kind:     TaskKindHttpCall,
		ExportAs: "",
	}

	// Manually call ExportAll()
	task.ExportAll()

	// Verify export was set
	if task.ExportAs != "${.}" {
		t.Errorf("Expected export to be '${.}', got: %s", task.ExportAs)
	}
}

// TestExportField_NotOverriddenByField verifies ExportField() isn't overridden by Field().
func TestExportField_NotOverriddenByField(t *testing.T) {
	task := &Task{
		Name:     "processData",
		Kind:     TaskKindSet,
		ExportAs: "",
	}

	// Set custom field export
	task.ExportField("count")
	customExport := task.ExportAs

	// Call Field() - should not override
	_ = task.Field("result")

	// Verify custom export was preserved
	if task.ExportAs != customExport {
		t.Errorf("Expected custom export %s to be preserved, got: %s", customExport, task.ExportAs)
	}
}
