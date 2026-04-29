package pythonrt

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// Config holds the parameters for managing a Python runtime environment.
type Config struct {
	// BaseDir is the root for all runtime versions
	// (e.g., ~/.stigmer/runtimes/agent-runner).
	BaseDir string

	// CLIVersion is the current CLI build version, used as the directory key
	// for version isolation.
	CLIVersion string

	// DepsSource is the path to a pip requirements file. When empty,
	// dependency installation is skipped entirely.
	DepsSource string

	// WheelDir is an optional path to a directory of pre-built wheels.
	// When non-empty, pip installs offline from this wheelhouse.
	WheelDir string

	// PostInstallCmds lists commands to run inside the venv after dependency
	// installation (e.g., namespace collision fixups). Each entry is a
	// command with its arguments.
	PostInstallCmds [][]string

	// AppSourceFS is an embedded filesystem containing the Python application
	// source code (e.g., agent-runner's main.py + worker/ package). When
	// non-nil, bootstrap extracts the contents into <runtime>/app/.
	AppSourceFS fs.FS

	// PreInstallFn runs after the application source is extracted into the
	// app directory but before dependency installation. Use it to copy
	// additional source trees that are not part of AppSourceFS (e.g.,
	// monorepo path dependencies in dev mode).
	PreInstallFn func(appDir string) error
}

// Manager manages the lifecycle of a hermetic Python runtime environment
// backed by python-build-standalone.
type Manager struct {
	config   Config
	platform Platform
}

// NewManager creates a runtime Manager for the current platform.
func NewManager(cfg Config) (*Manager, error) {
	if cfg.BaseDir == "" {
		return nil, errors.New("pythonrt: BaseDir is required")
	}
	if cfg.CLIVersion == "" {
		return nil, errors.New("pythonrt: CLIVersion is required")
	}
	p := DetectPlatform()
	if !p.IsSupported() {
		return nil, fmt.Errorf("pythonrt: unsupported platform %s", p)
	}
	return &Manager{config: cfg, platform: p}, nil
}

// RuntimeDir returns the versioned, platform-specific runtime directory.
func (m *Manager) RuntimeDir() string {
	return filepath.Join(m.config.BaseDir, m.config.CLIVersion, m.platform.String())
}

// PythonBin returns the path to the Python binary inside the venv.
func (m *Manager) PythonBin() string {
	return filepath.Join(m.venvDir(), "bin", "python")
}

// IsReady reports whether the runtime is bootstrapped and valid for the
// current CLI version. When AppSourceFS is configured, it also verifies
// that the extracted app directory exists.
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

// EnsureReady guarantees a valid Python runtime exists. When the runtime is
// already bootstrapped for the current CLI version this is a fast no-op.
//
// In dev mode (CLIVersion == "dev"), the app source and path dependencies
// are always refreshed so that code changes in the repo tree are picked up
// without requiring a manual `rm -rf ~/.stigmer/runtimes/agent-runner/`.
func (m *Manager) EnsureReady(ctx context.Context) error {
	if m.IsReady() {
		if m.config.CLIVersion == "dev" {
			return m.refreshDevSource(ctx)
		}
		log.Debug().
			Str("runtime_dir", m.RuntimeDir()).
			Msg("Python runtime already bootstrapped")
		return nil
	}
	return m.bootstrap(ctx)
}

// refreshDevSource re-extracts the application source and reinstalls path
// dependencies (graphton, stigmer-protos) into the existing venv. This is
// the dev-mode counterpart to a full bootstrap: it skips the expensive
// Python download and pip-install-from-PyPI steps, touching only the
// local source that developers actively change.
func (m *Manager) refreshDevSource(ctx context.Context) error {
	if m.config.AppSourceFS == nil {
		return nil
	}

	log.Debug().
		Str("app_dir", m.AppDir()).
		Msg("Dev mode: refreshing application source and path dependencies")

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
	if len(m.config.PostInstallCmds) > 0 {
		if err := runPostInstallCmds(ctx, m.venvDir(), m.config.PostInstallCmds); err != nil {
			return errors.Wrap(err, "failed to reinstall path dependencies during dev refresh")
		}
	}
	return nil
}

// AppDir returns the path to the extracted application source directory.
// Only meaningful when Config.AppSourceFS is set.
func (m *Manager) AppDir() string { return filepath.Join(m.RuntimeDir(), "app") }

// SetDeps configures dependency installation after Manager construction.
// This allows callers to reference AppDir() for paths that are only known
// after the Manager is created (e.g. app/requirements.txt).
func (m *Manager) SetDeps(depsSource string, postInstallCmds [][]string) {
	m.config.DepsSource = depsSource
	m.config.PostInstallCmds = postInstallCmds
}

func (m *Manager) pythonDir() string    { return filepath.Join(m.RuntimeDir(), "python") }
func (m *Manager) venvDir() string      { return filepath.Join(m.RuntimeDir(), "venv") }
func (m *Manager) manifestPath() string { return filepath.Join(m.RuntimeDir(), "manifest.json") }
func (m *Manager) basePythonBin() string {
	return filepath.Join(m.pythonDir(), "bin", "python3")
}

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

	if err := m.downloadAndExtractPython(ctx); err != nil {
		return err
	}
	// Extract app source before venv setup so that files referenced by
	// DepsSource (e.g. app/requirements.txt) and PostInstallCmds (e.g.
	// pip install app/libs/graphton) are on disk when pip runs.
	if err := m.extractAppSource(); err != nil {
		return err
	}
	if m.config.PreInstallFn != nil {
		if err := m.config.PreInstallFn(m.AppDir()); err != nil {
			return errors.Wrap(err, "pre-install hook failed")
		}
	}
	if err := m.setupVenv(ctx); err != nil {
		return err
	}
	if err := m.writeManifest(start); err != nil {
		return err
	}

	success = true
	return nil
}

// robustRemoveAll removes a directory tree reliably on macOS where
// Spotlight indexing can race with os.RemoveAll, causing persistent
// "directory not empty" errors even across retries.
//
// Strategy: rename the directory to a unique temp name first (atomic
// on all filesystems), then remove it. Even if RemoveAll fails on the
// renamed path, the original path is immediately clear for reuse.
func robustRemoveAll(dir string) error {
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return nil
	}

	tombstone := dir + fmt.Sprintf(".removing.%d", time.Now().UnixNano())
	if err := os.Rename(dir, tombstone); err != nil {
		// Rename failed (cross-device, permissions) — fall back to direct remove.
		return os.RemoveAll(dir)
	}

	if err := os.RemoveAll(tombstone); err != nil && runtime.GOOS == "darwin" {
		// Best-effort background cleanup on macOS. The renamed directory is
		// out of the way so it does not block the caller.
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

func (m *Manager) downloadAndExtractPython(ctx context.Context) error {
	tmpTarball := filepath.Join(m.RuntimeDir(), ".download.tar.gz")
	defer os.Remove(tmpTarball)

	if err := downloadPythonDist(m.platform, tmpTarball); err != nil {
		return errors.Wrap(err, "failed to download Python distribution")
	}
	if err := extractTarball(tmpTarball, m.RuntimeDir()); err != nil {
		return errors.Wrap(err, "failed to extract Python distribution")
	}
	if m.platform.OS == "darwin" {
		if err := clearQuarantine(m.pythonDir()); err != nil {
			log.Warn().Err(err).Msg("Failed to clear macOS quarantine attribute")
		}
	}
	return nil
}

func (m *Manager) setupVenv(ctx context.Context) error {
	log.Info().Msg("Creating virtual environment")
	if err := createVenv(ctx, m.basePythonBin(), m.venvDir()); err != nil {
		return errors.Wrap(err, "failed to create virtual environment")
	}

	if m.config.DepsSource != "" {
		log.Info().Msg("Installing dependencies")
		if err := installDependencies(ctx, m.PythonBin(), m.config.DepsSource, m.config.WheelDir); err != nil {
			return errors.Wrap(err, "failed to install dependencies")
		}
	}

	if len(m.config.PostInstallCmds) > 0 {
		if err := runPostInstallCmds(ctx, m.venvDir(), m.config.PostInstallCmds); err != nil {
			return errors.Wrap(err, "failed to run post-install commands")
		}
	}
	return nil
}

func (m *Manager) extractAppSource() error {
	if m.config.AppSourceFS == nil {
		return nil
	}
	log.Info().Msg("Extracting application source")
	if err := copyFS(m.config.AppSourceFS, m.AppDir()); err != nil {
		return errors.Wrap(err, "failed to extract application source")
	}
	return nil
}

func (m *Manager) writeManifest(start time.Time) error {
	depsHash := ""
	if m.config.DepsSource != "" {
		h, err := hashFile(m.config.DepsSource)
		if err != nil {
			return errors.Wrap(err, "failed to hash dependency lock file")
		}
		depsHash = h
	}

	manifest := &Manifest{
		SchemaVersion:       manifestSchemaVersion,
		CLIVersion:          m.config.CLIVersion,
		Platform:            m.platform.String(),
		PythonVersion:       PythonVersion,
		PBSTag:              PBSTag,
		DepsLockSHA256:      depsHash,
		InstalledAt:         time.Now(),
		BootstrapDurationMS: time.Since(start).Milliseconds(),
	}

	if err := manifest.Write(m.manifestPath()); err != nil {
		return errors.Wrap(err, "failed to write runtime manifest")
	}

	log.Info().
		Str("runtime_dir", m.RuntimeDir()).
		Str("python_version", PythonVersion).
		Int64("duration_ms", manifest.BootstrapDurationMS).
		Msg("Python runtime bootstrapped successfully")
	return nil
}
