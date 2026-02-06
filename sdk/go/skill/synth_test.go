package skill

import (
	"errors"
	"testing"
)

// =============================================================================
// Mock Context for Testing
// =============================================================================

// mockContext implements the Context interface for testing.
type mockContext struct {
	skills []*Skill
}

func (m *mockContext) RegisterSkill(s *Skill) {
	m.skills = append(m.skills, s)
}

// =============================================================================
// FromDir Tests
// =============================================================================

func TestFromDir_ValidPath(t *testing.T) {
	s, err := FromDir(nil, "./skills/calculator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s == nil {
		t.Fatal("expected skill to be non-nil")
	}
	if !s.IsLocal() {
		t.Error("expected skill to be local source")
	}
	if s.LocalPath() != "./skills/calculator" {
		t.Errorf("expected path './skills/calculator', got %q", s.LocalPath())
	}
}

func TestFromDir_EmptyPath_Error(t *testing.T) {
	s, err := FromDir(nil, "")
	if err == nil {
		t.Fatal("expected error for empty path")
	}
	if !errors.Is(err, ErrPathRequired) {
		t.Errorf("expected ErrPathRequired, got %v", err)
	}
	if s != nil {
		t.Error("expected skill to be nil on error")
	}
}

func TestFromDir_WithTag(t *testing.T) {
	s, err := FromDir(nil, "./calculator", WithTag("stable"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.Tag() != "stable" {
		t.Errorf("expected tag 'stable', got %q", s.Tag())
	}
}

func TestFromDir_ContextRegistration(t *testing.T) {
	ctx := &mockContext{}
	s, err := FromDir(ctx, "./calculator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ctx.skills) != 1 {
		t.Fatalf("expected 1 registered skill, got %d", len(ctx.skills))
	}
	if ctx.skills[0] != s {
		t.Error("registered skill does not match returned skill")
	}
}

func TestFromDir_NilContext_NoError(t *testing.T) {
	s, err := FromDir(nil, "./calculator")
	if err != nil {
		t.Fatalf("unexpected error with nil context: %v", err)
	}
	if s == nil {
		t.Fatal("expected skill to be non-nil")
	}
}

func TestFromDir_AbsolutePath(t *testing.T) {
	s, err := FromDir(nil, "/home/user/skills/calculator")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.LocalPath() != "/home/user/skills/calculator" {
		t.Errorf("expected absolute path, got %q", s.LocalPath())
	}
}

// =============================================================================
// FromGit Tests
// =============================================================================

func TestFromGit_ValidURL(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s == nil {
		t.Fatal("expected skill to be non-nil")
	}
	if !s.IsGit() {
		t.Error("expected skill to be git source")
	}
	if s.GitURL() != "https://github.com/stigmer/skills.git" {
		t.Errorf("expected URL 'https://github.com/stigmer/skills.git', got %q", s.GitURL())
	}
}

func TestFromGit_EmptyURL_Error(t *testing.T) {
	s, err := FromGit(nil, "")
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
	if !errors.Is(err, ErrUrlRequired) {
		t.Errorf("expected ErrUrlRequired, got %v", err)
	}
	if s != nil {
		t.Error("expected skill to be nil on error")
	}
}

func TestFromGit_WithRef(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git", WithRef("v1.0.0"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.GitRef() != "v1.0.0" {
		t.Errorf("expected ref 'v1.0.0', got %q", s.GitRef())
	}
}

func TestFromGit_WithSubdir(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git", WithSubdir("skills/calculator"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.GitSubdir() != "skills/calculator" {
		t.Errorf("expected subdir 'skills/calculator', got %q", s.GitSubdir())
	}
}

func TestFromGit_WithGitTag(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git", WithGitTag("stable"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.Tag() != "stable" {
		t.Errorf("expected tag 'stable', got %q", s.Tag())
	}
}

func TestFromGit_AllOptions(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git",
		WithRef("v1.0.0"),
		WithSubdir("skills/calculator"),
		WithGitTag("stable"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.GitURL() != "https://github.com/stigmer/skills.git" {
		t.Errorf("unexpected URL: %q", s.GitURL())
	}
	if s.GitRef() != "v1.0.0" {
		t.Errorf("unexpected ref: %q", s.GitRef())
	}
	if s.GitSubdir() != "skills/calculator" {
		t.Errorf("unexpected subdir: %q", s.GitSubdir())
	}
	if s.Tag() != "stable" {
		t.Errorf("unexpected tag: %q", s.Tag())
	}
}

func TestFromGit_ContextRegistration(t *testing.T) {
	ctx := &mockContext{}
	s, err := FromGit(ctx, "https://github.com/stigmer/skills.git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(ctx.skills) != 1 {
		t.Fatalf("expected 1 registered skill, got %d", len(ctx.skills))
	}
	if ctx.skills[0] != s {
		t.Error("registered skill does not match returned skill")
	}
}

func TestFromGit_SSHUrl(t *testing.T) {
	s, err := FromGit(nil, "git@github.com:stigmer/skills.git")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if s.GitURL() != "git@github.com:stigmer/skills.git" {
		t.Errorf("expected SSH URL, got %q", s.GitURL())
	}
}

// =============================================================================
// ToProto Tests
// =============================================================================

func TestToProto_LocalSource(t *testing.T) {
	s, err := FromDir(nil, "./skills/calculator")
	if err != nil {
		t.Fatalf("unexpected error creating skill: %v", err)
	}

	proto, err := s.ToProto()
	if err != nil {
		t.Fatalf("unexpected error converting to proto: %v", err)
	}

	if proto.GetLocal() == nil {
		t.Fatal("expected local source in proto")
	}
	if proto.GetLocal().GetPath() != "./skills/calculator" {
		t.Errorf("expected path './skills/calculator', got %q", proto.GetLocal().GetPath())
	}
	if proto.GetGit() != nil {
		t.Error("expected git source to be nil")
	}
}

func TestToProto_GitSource(t *testing.T) {
	s, err := FromGit(nil, "https://github.com/stigmer/skills.git",
		WithRef("v1.0.0"),
		WithSubdir("calculator"))
	if err != nil {
		t.Fatalf("unexpected error creating skill: %v", err)
	}

	proto, err := s.ToProto()
	if err != nil {
		t.Fatalf("unexpected error converting to proto: %v", err)
	}

	if proto.GetGit() == nil {
		t.Fatal("expected git source in proto")
	}
	if proto.GetGit().GetUrl() != "https://github.com/stigmer/skills.git" {
		t.Errorf("unexpected URL: %q", proto.GetGit().GetUrl())
	}
	if proto.GetGit().GetRef() != "v1.0.0" {
		t.Errorf("unexpected ref: %q", proto.GetGit().GetRef())
	}
	if proto.GetGit().GetSubdir() != "calculator" {
		t.Errorf("unexpected subdir: %q", proto.GetGit().GetSubdir())
	}
	if proto.GetLocal() != nil {
		t.Error("expected local source to be nil")
	}
}

func TestToProto_WithTag(t *testing.T) {
	s, err := FromDir(nil, "./calculator", WithTag("stable"))
	if err != nil {
		t.Fatalf("unexpected error creating skill: %v", err)
	}

	proto, err := s.ToProto()
	if err != nil {
		t.Fatalf("unexpected error converting to proto: %v", err)
	}

	if proto.GetTag() != "stable" {
		t.Errorf("expected tag 'stable', got %q", proto.GetTag())
	}
}

func TestToProto_NilSource_Error(t *testing.T) {
	// Create a skill with no source set (bypassing normal constructors)
	s := &Skill{}

	_, err := s.ToProto()
	if err == nil {
		t.Fatal("expected error for skill with no source")
	}
	if !errors.Is(err, ErrSourceNil) {
		t.Errorf("expected ErrSourceNil, got %v", err)
	}
}

// =============================================================================
// Accessor Method Tests
// =============================================================================

func TestSkill_IsLocal(t *testing.T) {
	local, _ := FromDir(nil, "./calculator")
	if !local.IsLocal() {
		t.Error("expected IsLocal() to be true for local skill")
	}
	if local.IsGit() {
		t.Error("expected IsGit() to be false for local skill")
	}

	git, _ := FromGit(nil, "https://github.com/stigmer/skills.git")
	if git.IsLocal() {
		t.Error("expected IsLocal() to be false for git skill")
	}
	if !git.IsGit() {
		t.Error("expected IsGit() to be true for git skill")
	}
}

func TestSkill_IsGit(t *testing.T) {
	git, _ := FromGit(nil, "https://github.com/stigmer/skills.git")
	if !git.IsGit() {
		t.Error("expected IsGit() to be true for git skill")
	}
}

func TestSkill_LocalPath_EmptyForGit(t *testing.T) {
	git, _ := FromGit(nil, "https://github.com/stigmer/skills.git")
	if git.LocalPath() != "" {
		t.Errorf("expected empty LocalPath for git skill, got %q", git.LocalPath())
	}
}

func TestSkill_GitFields_EmptyForLocal(t *testing.T) {
	local, _ := FromDir(nil, "./calculator")
	if local.GitURL() != "" {
		t.Errorf("expected empty GitURL for local skill, got %q", local.GitURL())
	}
	if local.GitRef() != "" {
		t.Errorf("expected empty GitRef for local skill, got %q", local.GitRef())
	}
	if local.GitSubdir() != "" {
		t.Errorf("expected empty GitSubdir for local skill, got %q", local.GitSubdir())
	}
}

// =============================================================================
// String Tests
// =============================================================================

func TestSkill_String_Local(t *testing.T) {
	s, _ := FromDir(nil, "./calculator")
	str := s.String()
	if str != "Skill(local=./calculator)" {
		t.Errorf("unexpected string: %q", str)
	}
}

func TestSkill_String_LocalWithTag(t *testing.T) {
	s, _ := FromDir(nil, "./calculator", WithTag("stable"))
	str := s.String()
	if str != "Skill(local=./calculator, tag=stable)" {
		t.Errorf("unexpected string: %q", str)
	}
}

func TestSkill_String_Git(t *testing.T) {
	s, _ := FromGit(nil, "https://github.com/stigmer/skills.git")
	str := s.String()
	if str != "Skill(git=https://github.com/stigmer/skills.git)" {
		t.Errorf("unexpected string: %q", str)
	}
}

func TestSkill_String_GitWithRef(t *testing.T) {
	s, _ := FromGit(nil, "https://github.com/stigmer/skills.git", WithRef("v1.0"))
	str := s.String()
	if str != "Skill(git=https://github.com/stigmer/skills.git@v1.0)" {
		t.Errorf("unexpected string: %q", str)
	}
}

func TestSkill_String_GitWithSubdir(t *testing.T) {
	s, _ := FromGit(nil, "https://github.com/stigmer/skills.git", WithSubdir("calc"))
	str := s.String()
	if str != "Skill(git=https://github.com/stigmer/skills.git, subdir=calc)" {
		t.Errorf("unexpected string: %q", str)
	}
}

func TestSkill_String_GitFull(t *testing.T) {
	s, _ := FromGit(nil, "https://github.com/stigmer/skills.git",
		WithRef("v1.0"),
		WithSubdir("calc"),
		WithGitTag("stable"))
	str := s.String()
	expected := "Skill(git=https://github.com/stigmer/skills.git@v1.0, subdir=calc, tag=stable)"
	if str != expected {
		t.Errorf("expected %q, got %q", expected, str)
	}
}

// =============================================================================
// Error Tests
// =============================================================================

func TestErrors_CanUseErrorsIs(t *testing.T) {
	_, err := FromDir(nil, "")
	if !errors.Is(err, ErrPathRequired) {
		t.Error("expected errors.Is to work with ErrPathRequired")
	}

	_, err = FromGit(nil, "")
	if !errors.Is(err, ErrUrlRequired) {
		t.Error("expected errors.Is to work with ErrUrlRequired")
	}

	s := &Skill{}
	_, err = s.ToProto()
	if !errors.Is(err, ErrSourceNil) {
		t.Error("expected errors.Is to work with ErrSourceNil")
	}
}

// =============================================================================
// Multiple Registration Tests
// =============================================================================

func TestMultipleSkills_ContextRegistration(t *testing.T) {
	ctx := &mockContext{}

	s1, _ := FromDir(ctx, "./calculator")
	s2, _ := FromGit(ctx, "https://github.com/stigmer/skills.git")
	s3, _ := FromDir(ctx, "./web-search", WithTag("stable"))

	if len(ctx.skills) != 3 {
		t.Fatalf("expected 3 registered skills, got %d", len(ctx.skills))
	}
	if ctx.skills[0] != s1 {
		t.Error("first skill mismatch")
	}
	if ctx.skills[1] != s2 {
		t.Error("second skill mismatch")
	}
	if ctx.skills[2] != s3 {
		t.Error("third skill mismatch")
	}
}
