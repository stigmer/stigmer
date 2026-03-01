package pythonrt

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// extractTarball extracts a tar.gz archive at tarballPath into destDir.
// Handles regular files, directories, and symlinks. Rejects entries that
// would escape destDir (path traversal protection).
func extractTarball(tarballPath, destDir string) error {
	f, err := os.Open(tarballPath)
	if err != nil {
		return errors.Wrapf(err, "failed to open tarball %s", tarballPath)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return errors.Wrap(err, "failed to create gzip reader")
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	cleanDest := filepath.Clean(destDir)
	fileCount := 0

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.Wrap(err, "failed to read tar entry")
		}

		target := filepath.Join(destDir, header.Name)
		if !isInsideDir(target, cleanDest) {
			return fmt.Errorf("tar entry escapes destination directory: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return errors.Wrapf(err, "failed to create directory %s", header.Name)
			}
		case tar.TypeReg:
			if err := writeFile(target, tr, os.FileMode(header.Mode)); err != nil {
				return errors.Wrapf(err, "failed to extract %s", header.Name)
			}
			fileCount++
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return errors.Wrapf(err, "failed to create parent for symlink %s", header.Name)
			}
			if err := os.Symlink(header.Linkname, target); err != nil {
				return errors.Wrapf(err, "failed to create symlink %s", header.Name)
			}
		default:
			log.Debug().
				Str("name", header.Name).
				Int("type", int(header.Typeflag)).
				Msg("Skipping unsupported tar entry type")
		}
	}

	log.Debug().Int("files", fileCount).Str("dest", destDir).Msg("Tarball extracted")
	return nil
}

// writeFile creates a regular file at target with the given mode and contents.
func writeFile(target string, src io.Reader, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
		return errors.Wrap(err, "failed to create parent directory")
	}
	out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return errors.Wrap(err, "failed to create file")
	}
	defer out.Close()

	if _, err := io.Copy(out, src); err != nil {
		return errors.Wrap(err, "failed to write file contents")
	}
	return nil
}

// isInsideDir reports whether target is equal to or a child of dir.
func isInsideDir(target, dir string) bool {
	clean := filepath.Clean(target)
	if clean == dir {
		return true
	}
	return strings.HasPrefix(clean, dir+string(os.PathSeparator))
}

// clearQuarantine removes the com.apple.quarantine extended attribute from
// all files under dir. This is needed on macOS for downloaded binaries.
// On non-macOS platforms, this is a no-op.
func clearQuarantine(dir string) error {
	if runtime.GOOS != "darwin" {
		return nil
	}
	cmd := exec.Command("xattr", "-dr", "com.apple.quarantine", dir)
	if output, err := cmd.CombinedOutput(); err != nil {
		return errors.Wrapf(err, "xattr quarantine removal failed: %s", strings.TrimSpace(string(output)))
	}
	return nil
}
