package pythonrt

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
)

// copyFS recursively copies all files and directories from src (an fs.FS)
// into the destDir on disk. Existing files at destDir are overwritten.
func copyFS(src fs.FS, destDir string) error {
	return fs.WalkDir(src, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		target := filepath.Join(destDir, path)

		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}

		return copyFSFile(src, path, target)
	})
}

func copyFSFile(src fs.FS, srcPath, destPath string) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
		return errors.Wrapf(err, "failed to create parent directory for %s", destPath)
	}

	in, err := src.Open(srcPath)
	if err != nil {
		return errors.Wrapf(err, "failed to open embedded file %s", srcPath)
	}
	defer in.Close()

	out, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return errors.Wrapf(err, "failed to create %s", destPath)
	}
	defer out.Close()

	if _, err := io.Copy(out, in); err != nil {
		return errors.Wrapf(err, "failed to write %s", destPath)
	}

	return nil
}
