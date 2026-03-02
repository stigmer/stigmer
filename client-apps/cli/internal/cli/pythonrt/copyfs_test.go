package pythonrt

import (
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestCopyFS(t *testing.T) {
	src := fstest.MapFS{
		"main.py":                 {Data: []byte("print('hello')\n")},
		"worker/__init__.py":      {Data: []byte("")},
		"worker/config.py":        {Data: []byte("MODE='local'\n")},
		"worker/sub/deep_file.py": {Data: []byte("deep\n")},
	}

	dest := filepath.Join(t.TempDir(), "app")

	if err := copyFS(src, dest); err != nil {
		t.Fatalf("copyFS: %v", err)
	}

	tests := []struct {
		path    string
		content string
	}{
		{"main.py", "print('hello')\n"},
		{"worker/__init__.py", ""},
		{"worker/config.py", "MODE='local'\n"},
		{"worker/sub/deep_file.py", "deep\n"},
	}

	for _, tt := range tests {
		data, err := os.ReadFile(filepath.Join(dest, tt.path))
		if err != nil {
			t.Errorf("ReadFile(%s): %v", tt.path, err)
			continue
		}
		if string(data) != tt.content {
			t.Errorf("content of %s = %q, want %q", tt.path, string(data), tt.content)
		}
	}
}

func TestCopyFS_EmptyFS(t *testing.T) {
	src := fstest.MapFS{}
	dest := filepath.Join(t.TempDir(), "empty")

	if err := copyFS(src, dest); err != nil {
		t.Fatalf("copyFS with empty FS: %v", err)
	}

	info, err := os.Stat(dest)
	if err != nil {
		t.Fatalf("Stat(%s): %v", dest, err)
	}
	if !info.IsDir() {
		t.Errorf("expected directory at %s", dest)
	}
}
