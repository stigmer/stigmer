// Package seedpack provides the embedded system resources for Stigmer server bootstrap.
//
// The seedpack is a standard Stigmer project (with stigmer.yaml) containing vendored
// skills, system agents, and MCP server definitions. It is embedded in the CLI binary
// at build time and extracted to a temp directory during bootstrap, where `stigmer apply`
// processes it using the same code path as any user project.
//
// This package intentionally contains no resource parsing, validation, or apply logic.
// All of that lives in the CLI's declarative apply flow — one code path for everything.
package seedpack

import (
	"crypto/sha256"
	"encoding/hex"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
)

// ExtractToDir writes all embedded seedpack files to destDir, preserving the
// directory structure. The result is a complete Stigmer project directory that
// `stigmer apply` can process directly.
func ExtractToDir(destDir string) error {
	return fs.WalkDir(content, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		target := filepath.Join(destDir, path)

		if d.IsDir() {
			return os.MkdirAll(target, 0755)
		}

		data, err := content.ReadFile(path)
		if err != nil {
			return errors.Wrapf(err, "read embedded file %s", path)
		}

		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return errors.Wrapf(err, "create parent directory for %s", target)
		}

		return os.WriteFile(target, data, 0644)
	})
}

// ContentHash returns a deterministic SHA-256 hash over all embedded files.
// Files are walked in lexical order (guaranteed by fs.WalkDir) and each file's
// path and content contribute to the hash. Any file change (add, modify, remove)
// produces a different hash.
//
// Used by the CLI to detect when the seedpack has changed between binary versions
// and needs re-bootstrapping.
func ContentHash() (string, error) {
	h := sha256.New()

	err := fs.WalkDir(content, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := content.ReadFile(path)
		if err != nil {
			return errors.Wrapf(err, "read embedded file %s", path)
		}
		h.Write([]byte(path))
		h.Write([]byte{0})
		h.Write(data)
		return nil
	})
	if err != nil {
		return "", errors.Wrap(err, "walk embedded filesystem")
	}

	return "sha256:" + hex.EncodeToString(h.Sum(nil))[:16], nil
}
