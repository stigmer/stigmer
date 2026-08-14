package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ============================================================================
// generateSDKTypesFile — hand-written wrapper awareness (#716)
//
// The sdk-root types.go aliases every generated resource client EXCEPT the
// ones a hand-written wrapper shadows (handWrittenClientWrappers). PR #703
// removed the SkillClient alias by hand; the next regeneration clobbered the
// edit back in and broke the build with a redeclaration. These tests pin the
// generator-side contract so the collision class cannot recur.
// ============================================================================

func TestGenerateSDKTypesFileSkipsHandWrittenWrappers(t *testing.T) {
	dir := t.TempDir()
	resources := []resourceGenInfo{
		{resource: "session", clientName: "SessionClient"},
		{resource: "skill", clientName: "SkillClient"},
		{resource: "workflow", clientName: "WorkflowClient"},
	}

	if err := generateSDKTypesFile(dir, resources); err != nil {
		t.Fatalf("generateSDKTypesFile: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "types.go"))
	if err != nil {
		t.Fatalf("read generated types.go: %v", err)
	}
	got := string(raw)

	// The wrapper-shadowed client must NOT get an alias — the hand-written
	// sdk/go/skill.go declares the exported SkillClient and an alias would
	// redeclare it in the same package.
	if strings.Contains(got, "type SkillClient = gen.SkillClient") {
		t.Errorf("types.go re-emits the SkillClient alias that collides with the hand-written wrapper:\n%s", got)
	}
	// In its place stands the explanatory comment, so the generated file
	// documents its own hole instead of silently leaving one.
	if !strings.Contains(got, "// SkillClient is NOT aliased here") {
		t.Errorf("types.go is missing the hand-written-wrapper explanation comment:\n%s", got)
	}
	// Neighbors are unaffected.
	for _, want := range []string{
		"type SessionClient = gen.SessionClient",
		"type WorkflowClient = gen.WorkflowClient",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("types.go is missing expected alias %q:\n%s", want, got)
		}
	}
}

// Regeneration must be idempotent: running the generator over an unchanged
// resource set twice yields byte-identical output. This is the property the
// codegen-freshness CI gate assumes, and the one the #716 clobber violated
// (hand-edit in one direction, regeneration in the other).
func TestGenerateSDKTypesFileIsIdempotent(t *testing.T) {
	resources := []resourceGenInfo{
		{resource: "skill", clientName: "SkillClient"},
		{resource: "workflow", clientName: "WorkflowClient"},
	}

	render := func() string {
		dir := t.TempDir()
		if err := generateSDKTypesFile(dir, resources); err != nil {
			t.Fatalf("generateSDKTypesFile: %v", err)
		}
		raw, err := os.ReadFile(filepath.Join(dir, "types.go"))
		if err != nil {
			t.Fatalf("read generated types.go: %v", err)
		}
		return string(raw)
	}

	if first, second := render(), render(); first != second {
		t.Errorf("two renders of the same resource set differ:\n--- first ---\n%s\n--- second ---\n%s", first, second)
	}
}
