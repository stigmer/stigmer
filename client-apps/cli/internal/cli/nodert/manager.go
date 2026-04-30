// Package nodert provides Node.js runtime detection and dependency management
// for TypeScript services managed by the Stigmer CLI (e.g., cursor-runner).
//
// Two modes are supported:
//
//   - Dev mode: System Node.js + tsx from the repo tree. Served by the
//     existing functions in bootstrap.go (EnsureNodeAvailable, EnsureDepsInstalled,
//     TsxArgs).
//
//   - Managed mode: A hermetic Node.js runtime downloaded from nodejs.org
//     and cached under ~/.stigmer/runtimes/. Managed by the Manager type
//     in this file, which mirrors pythonrt.Manager.
package nodert

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// Config holds the parameters for managing a Node.js runtime environment.
type Config struct {
	// BaseDir is the root for all runtime versions
	// (e.g., ~/.stigmer/runtimes/cursor-runner).
	BaseDir string

	// CLIVersion is the current CLI build version, used as the directory key
	// for version isolation.
	CLIVersion string

	// AppSourceFS is an embedded filesystem containing the application source
	// (compiled JS + package.json + lockfile). When non-nil, bootstrap extracts
	// the contents into <runtime>/app/.
	AppSourceFS fs.FS

	// PreInstallFn runs after the application source is extracted but before
	// npm install. Used in dev mode to copy path dependencies from the repo.
	PreInstallFn func(appDir string) error
}

// Manager manages the lifecycle of a hermetic Node.js runtime environment
// backed by official Node.js distributions from nodejs.org.
type Manager struct {
	config   Config
	platform Platform
}

// NewManager creates a runtime Manager for the current platform.
func NewManager(cfg Config) (*Manager, error) {
	if cfg.BaseDir == "" {
		return nil, errors.New("nodert: BaseDir is required")
	}
	if cfg.CLIVersion == "" {
		return nil, errors.New("nodert: CLIVersion is required")
	}
	p := DetectPlatform()
	if !p.IsSupported() {
		return nil, fmt.Errorf("nodert: unsupported platform %s", p)
	}
	return &Manager{config: cfg, platform: p}, nil
}

// RuntimeDir returns the versioned, platform-specific runtime directory.
func (m *Manager) RuntimeDir() string {
	return filepath.Join(m.config.BaseDir, m.config.CLIVersion, m.platform.String())
}

// NodeBin returns the path to the node binary inside the managed runtime.
func (m *Manager) NodeBin() string {
	return filepath.Join(m.nodeDir(), "bin", "node")
}

// NpmBin returns the path to the npm binary inside the managed runtime.
func (m *Manager) NpmBin() string {
	return filepath.Join(m.nodeDir(), "bin", "npm")
}

// AppDir returns the path to the extracted application source directory.
func (m *Manager) AppDir() string {
	return filepath.Join(m.RuntimeDir(), "app")
}

// IsReady reports whether the runtime is bootstrapped and valid for the
// current CLI version.
func (m *Manager) IsReady() bool {
	manifest, err := ReadManifest(m.manifestPath())
	if err != nil {
		return false
	}
	if !manifest.IsValid(m.config.CLIVersion) {
		return false
	}
	if m.config.AppSourceFS != nil {
		if _, err := os.Stat(m.AppDir()); err != nil {
			return false
		}
	}
	return true
}

// EnsureReady guarantees a valid Node.js runtime exists. When the runtime
// is already bootstrapped for the current CLI version this is a fast no-op.
//
// In dev mode (CLIVersion == "dev"), the app source is always refreshed so
// that code changes in the repo tree are picked up without manual cleanup.
func (m *Manager) EnsureReady(ctx context.Context) error {
	if m.IsReady() {
		if m.config.CLIVersion == "dev" {
			return m.refreshDevSource(ctx)
		}
		log.Debug().
			Str("runtime_dir", m.RuntimeDir()).
			Msg("Node.js runtime already bootstrapped")
		return nil
	}
	return m.bootstrap(ctx)
}

func (m *Manager) nodeDir() string      { return filepath.Join(m.RuntimeDir(), "node") }
func (m *Manager) manifestPath() string { return filepath.Join(m.RuntimeDir(), "manifest.json") }

// ---------------------------------------------------------------------------
// Bootstrap orchestration
// ---------------------------------------------------------------------------

// bootstrap performs a complete runtime provisioning. The operation is atomic:
// if any step fails the runtime directory is removed so no partial state
// remains on disk.
func (m *Manager) bootstrap(ctx context.Context) error {
	runtimeDir := m.RuntimeDir()
	if err := prepareDir(runtimeDir); err != nil {
		return err
	}

	success := false
	defer func() {
		if !success {
			_ = robustRemoveAll(runtimeDir)
		}
	}()

	start := time.Now()

	if err := m.downloadAndExtractNode(ctx); err != nil {
		return err
	}
	if err := m.extractAppSource(); err != nil {
		return err
	}
	if m.config.PreInstallFn != nil {
		if err := m.config.PreInstallFn(m.AppDir()); err != nil {
			return errors.Wrap(err, "pre-install hook failed")
		}
	}
	if err := m.installDeps(ctx); err != nil {
		return err
	}
	if err := m.writeManifest(start); err != nil {
		return err
	}

	success = true
	return nil
}

// refreshDevSource re-extracts the application source in dev mode so that
// local code changes are picked up without requiring a manual cleanup.
func (m *Manager) refreshDevSource(ctx context.Context) error {
	if m.config.AppSourceFS == nil {
		return nil
	}

	log.Debug().
		Str("app_dir", m.AppDir()).
		Msg("Dev mode: refreshing application source")

	if err := robustRemoveAll(m.AppDir()); err != nil {
		return errors.Wrap(err, "failed to remove stale app source")
	}
	if err := m.extractAppSource(); err != nil {
		return err
	}
	if m.config.PreInstallFn != nil {
		if err := m.config.PreInstallFn(m.AppDir()); err != nil {
			return errors.Wrap(err, "pre-install hook failed during dev refresh")
		}
	}
	return nil
}

func (m *Manager) downloadAndExtractNode(ctx context.Context) error {
	tmpTarball := filepath.Join(m.RuntimeDir(), ".download.tar.gz")
	defer os.Remove(tmpTarball)

	if err := downloadNodeDist(m.platform, tmpTarball); err != nil {
		return errors.Wrap(err, "failed to download Node.js distribution")
	}

	stripPrefix, err := m.platform.StripPrefix()
	if err != nil {
		return err
	}

	if err := extractTarballWithStrip(tmpTarball, m.nodeDir(), stripPrefix); err != nil {
		return errors.Wrap(err, "failed to extract Node.js distribution")
	}

	if m.platform.OS == "darwin" {
		if err := clearQuarantine(m.nodeDir()); err != nil {
			log.Warn().Err(err).Msg("Failed to clear macOS quarantine attribute")
		}
	}
	return nil
}

func (m *Manager) extractAppSource() error {
	if m.config.AppSourceFS == nil {
		return nil
	}
	log.Info().Msg("Extracting cursor-runner application source")
	return copyFS(m.config.AppSourceFS, m.AppDir())
}

func (m *Manager) installDeps(ctx context.Context) error {
	lockFile := filepath.Join(m.AppDir(), "package-lock.json")
	if _, err := os.Stat(lockFile); os.IsNotExist(err) {
		log.Debug().Msg("No package-lock.json found, skipping npm install")
		return nil
	}

	log.Info().Str("dir", m.AppDir()).Msg("Installing Node.js dependencies")

	cmd := exec.CommandContext(ctx, m.NodeBin(), m.NpmBin(), "install", "--prefer-offline")
	cmd.Dir = m.AppDir()
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	// npm needs to find node on PATH for lifecycle scripts
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("PATH=%s:%s", filepath.Dir(m.NodeBin()), os.Getenv("PATH")),
	)

	if err := cmd.Run(); err != nil {
		return errors.Wrap(err, "npm install failed")
	}

	log.Info().Str("dir", m.AppDir()).Msg("Node.js dependencies installed")
	return nil
}

func (m *Manager) writeManifest(start time.Time) error {
	depsHash := ""
	lockFile := filepath.Join(m.AppDir(), "package-lock.json")
	if _, err := os.Stat(lockFile); err == nil {
		h, err := hashFile(lockFile)
		if err != nil {
			return errors.Wrap(err, "failed to hash dependency lock file")
		}
		depsHash = h
	}

	manifest := &Manifest{
		SchemaVersion:       manifestSchemaVersion,
		CLIVersion:          m.config.CLIVersion,
		Platform:            m.platform.String(),
		NodeVersion:         NodeVersion,
		DepsLockSHA256:      depsHash,
		InstalledAt:         time.Now(),
		BootstrapDurationMS: time.Since(start).Milliseconds(),
	}

	if err := manifest.Write(m.manifestPath()); err != nil {
		return errors.Wrap(err, "failed to write runtime manifest")
	}

	log.Info().
		Str("runtime_dir", m.RuntimeDir()).
		Str("node_version", NodeVersion).
		Int64("duration_ms", manifest.BootstrapDurationMS).
		Msg("Node.js runtime bootstrapped successfully")
	return nil
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

// extractTarballWithStrip extracts a tar.gz archive, stripping the given
// top-level directory prefix. For example, a Node.js tarball contains
// "node-v22.22.2-darwin-arm64/bin/node" -- with stripPrefix set to
// "node-v22.22.2-darwin-arm64", the file is extracted as "<destDir>/bin/node".
func extractTarballWithStrip(tarballPath, destDir, stripPrefix string) error {
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
	prefix := stripPrefix + "/"
	fileCount := 0

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return errors.Wrap(err, "failed to read tar entry")
		}

		name := header.Name
		if !strings.HasPrefix(name, prefix) && name != stripPrefix+"/" {
			continue
		}
		name = strings.TrimPrefix(name, prefix)
		if name == "" {
			continue
		}

		target := filepath.Join(destDir, name)
		if !isInsideDir(target, cleanDest) {
			return fmt.Errorf("tar entry escapes destination directory: %s", header.Name)
		}

		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, os.FileMode(header.Mode)); err != nil {
				return errors.Wrapf(err, "failed to create directory %s", name)
			}
		case tar.TypeReg:
			if err := writeFile(target, tr, os.FileMode(header.Mode)); err != nil {
				return errors.Wrapf(err, "failed to extract %s", name)
			}
			fileCount++
		case tar.TypeSymlink:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return errors.Wrapf(err, "failed to create parent for symlink %s", name)
			}
			if err := os.Symlink(header.Linkname, target); err != nil {
				return errors.Wrapf(err, "failed to create symlink %s", name)
			}
		default:
			log.Debug().
				Str("name", name).
				Int("type", int(header.Typeflag)).
				Msg("Skipping unsupported tar entry type")
		}
	}

	log.Debug().Int("files", fileCount).Str("dest", destDir).Msg("Node.js tarball extracted")
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
// all files under dir. Needed on macOS for downloaded binaries.
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

// copyFS recursively copies all files and directories from src (an fs.FS)
// into the destDir on disk.
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

// robustRemoveAll removes a directory tree reliably on macOS where
// Spotlight indexing can race with os.RemoveAll.
func robustRemoveAll(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}
	tombstone := dir + fmt.Sprintf(".removing.%d", time.Now().UnixNano())
	if err := os.Rename(dir, tombstone); err != nil {
		return os.RemoveAll(dir)
	}
	if err := os.RemoveAll(tombstone); err != nil && runtime.GOOS == "darwin" {
		log.Debug().Err(err).Str("path", tombstone).
			Msg("Background cleanup of renamed directory failed (non-blocking)")
	}
	return nil
}

// prepareDir removes any stale directory at path and creates a fresh one.
func prepareDir(dir string) error {
	if err := robustRemoveAll(dir); err != nil {
		return errors.Wrap(err, "failed to remove stale runtime directory")
	}
	if err := os.MkdirAll(dir, 0755); err != nil {
		return errors.Wrap(err, "failed to create runtime directory")
	}
	return nil
}
