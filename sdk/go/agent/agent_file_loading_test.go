package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWithInstructionsFromFile(t *testing.T) {
	// Create temporary directory for test files
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test-instructions.md")

	// Write test content to file
	testContent := "This is a test instruction file with more than 10 characters"
	if err := os.WriteFile(testFile, []byte(testContent), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	tests := []struct {
		name    string
		path    string
		wantErr bool
		errType error
	}{
		{
			name:    "valid instructions file",
			path:    testFile,
			wantErr: false,
		},
		{
			name:    "non-existent file",
			path:    filepath.Join(tmpDir, "non-existent.md"),
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent, err := New(
				WithName("test-agent"),
				WithInstructionsFromFile(tt.path),
			)

			if tt.wantErr {
				if err == nil {
					t.Errorf("New() expected error but got none")
					return
				}
			} else {
				if err != nil {
					t.Errorf("New() unexpected error = %v", err)
					return
				}
				if agent == nil {
					t.Error("New() returned nil agent")
					return
				}

				// Verify instructions were loaded
				if agent.Instructions != testContent {
					t.Errorf("Instructions = %q, want %q", agent.Instructions, testContent)
				}
			}
		})
	}
}

func TestWithInstructionsFromFile_EmptyFile(t *testing.T) {
	// Create temporary directory for test files
	tmpDir := t.TempDir()
	emptyFile := filepath.Join(tmpDir, "empty.md")

	// Create empty file
	if err := os.WriteFile(emptyFile, []byte(""), 0644); err != nil {
		t.Fatalf("Failed to create empty file: %v", err)
	}

	agent, err := New(
		WithName("test-agent"),
		WithInstructionsFromFile(emptyFile),
	)

	// Should fail validation because instructions are empty
	if err == nil {
		t.Error("New() expected error for empty file, got none")
	}
	if agent != nil {
		t.Error("New() returned non-nil agent for empty file")
	}
}

func TestWithInstructionsFromFile_TooShort(t *testing.T) {
	// Create temporary directory for test files
	tmpDir := t.TempDir()
	shortFile := filepath.Join(tmpDir, "short.md")

	// Create file with content that's too short
	if err := os.WriteFile(shortFile, []byte("short"), 0644); err != nil {
		t.Fatalf("Failed to create short file: %v", err)
	}

	agent, err := New(
		WithName("test-agent"),
		WithInstructionsFromFile(shortFile),
	)

	// Should fail validation because instructions are too short
	if err == nil {
		t.Error("New() expected error for too short instructions, got none")
	}
	if agent != nil {
		t.Error("New() returned non-nil agent for too short instructions")
	}
}

func TestWithInstructionsFromFile_LargeFile(t *testing.T) {
	// Create temporary directory for test files
	tmpDir := t.TempDir()
	largeFile := filepath.Join(tmpDir, "large.md")

	// Create file with large content (within limits)
	largeContent := make([]byte, 5000)
	for i := range largeContent {
		largeContent[i] = 'a'
	}
	if err := os.WriteFile(largeFile, largeContent, 0644); err != nil {
		t.Fatalf("Failed to create large file: %v", err)
	}

	agent, err := New(
		WithName("test-agent"),
		WithInstructionsFromFile(largeFile),
	)

	if err != nil {
		t.Errorf("New() unexpected error for large file = %v", err)
		return
	}

	if len(agent.Instructions) != 5000 {
		t.Errorf("Instructions length = %d, want 5000", len(agent.Instructions))
	}
}
