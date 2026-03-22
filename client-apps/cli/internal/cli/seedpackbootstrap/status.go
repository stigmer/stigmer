package seedpackbootstrap

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/stigmer/stigmer/seedpack"
)

// CurrentHash returns the SHA-256 content hash of the embedded seedpack.
func CurrentHash() (string, error) {
	return seedpack.ContentHash()
}

// MarkerStatus checks whether a seedpack marker file exists in the given
// directory and returns the stored hash. Returns (true, hash) if the marker
// exists and is readable, or (false, "") otherwise.
func MarkerStatus(markerDir string) (applied bool, storedHash string) {
	if markerDir == "" {
		return false, ""
	}

	markerPath := filepath.Join(markerDir, markerFileName)
	data, err := os.ReadFile(markerPath)
	if err != nil {
		return false, ""
	}

	return true, strings.TrimSpace(string(data))
}
