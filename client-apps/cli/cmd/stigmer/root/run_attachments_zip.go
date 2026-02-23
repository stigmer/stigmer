package root

import (
	"archive/zip"
	"bytes"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
)

// maxAttachmentSize is the maximum allowed size for an attachment upload.
// Must match the server's grpc.MaxRecvMsgSize (backend/libs/go/grpc/server.go).
const maxAttachmentSize = 10 * 1024 * 1024 // 10 MB

// zipDirectory creates a zip archive from the contents of dirPath.
// Hidden entries (names starting with '.') are skipped along with their subtrees.
// Symlinks are skipped with a warning printed to the user.
// Returns the zip bytes, the number of files included, and their total uncompressed size.
func zipDirectory(dirPath string) ([]byte, int, int64, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)

	var fileCount int
	var originalSize int64

	err := filepath.WalkDir(dirPath, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return errors.Wrapf(walkErr, "failed to access %s", path)
		}

		if isHiddenEntry(d.Name()) {
			if d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		if d.Type()&fs.ModeSymlink != 0 {
			cliprint.PrintWarning("Skipping symlink: %s", path)
			return nil
		}

		if d.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(dirPath, path)
		if err != nil {
			return errors.Wrapf(err, "failed to compute relative path for %s", path)
		}
		relPath = filepath.ToSlash(relPath)

		content, err := os.ReadFile(path)
		if err != nil {
			return errors.Wrapf(err, "failed to read %s", relPath)
		}

		header := &zip.FileHeader{
			Name:   relPath,
			Method: zip.Deflate,
		}

		info, err := d.Info()
		if err != nil {
			return errors.Wrapf(err, "failed to stat %s", relPath)
		}
		header.Modified = info.ModTime()

		entry, err := w.CreateHeader(header)
		if err != nil {
			return errors.Wrapf(err, "failed to create zip entry for %s", relPath)
		}

		if _, err := entry.Write(content); err != nil {
			return errors.Wrapf(err, "failed to write zip entry for %s", relPath)
		}

		fileCount++
		originalSize += info.Size()
		return nil
	})
	if err != nil {
		return nil, 0, 0, errors.Wrap(err, "failed to walk directory")
	}

	if fileCount == 0 {
		return nil, 0, 0, fmt.Errorf("directory contains no attachable files: %s", dirPath)
	}

	if err := w.Close(); err != nil {
		return nil, 0, 0, errors.Wrap(err, "failed to finalize zip archive")
	}

	return buf.Bytes(), fileCount, originalSize, nil
}

// isHiddenEntry reports whether a file or directory name is hidden.
// On Unix, any name starting with '.' is considered hidden.
func isHiddenEntry(name string) bool {
	return strings.HasPrefix(name, ".")
}
