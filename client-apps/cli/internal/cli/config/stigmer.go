package config

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"gopkg.in/yaml.v3"
)

// StigmerConfig represents the minimal Stigmer.yaml configuration
// This file defines project metadata and entry point, but NOT resource declarations.
// Resources (agents, workflows) are auto-discovered by executing the entry point.
type StigmerConfig struct {
	// Name is the project name (required)
	Name string `yaml:"name"`

	// Runtime specifies the SDK runtime (required)
	// Currently supported: "go"
	Runtime string `yaml:"runtime"`

	// Version is the project version (optional)
	Version string `yaml:"version,omitempty"`

	// Main is the entry point file (optional, default: "main.go")
	// This file is executed to generate the manifest with all resources
	Main string `yaml:"main,omitempty"`

	// Organization is the organization ID override (optional)
	// If not set, uses the organization from CLI context
	Organization string `yaml:"organization,omitempty"`

	// BaseDir is the directory where Stigmer.yaml was found (not serialized)
	// Used to resolve relative paths in the config
	BaseDir string `yaml:"-"`
}

// DefaultStigmerConfigFilename is the standard name for stigmer config files
const DefaultStigmerConfigFilename = "Stigmer.yaml"

// LoadStigmerConfig loads Stigmer.yaml from the specified path.
// If path is empty or "Stigmer.yaml", it searches in the current directory.
// If path is a directory, it looks for Stigmer.yaml inside that directory.
func LoadStigmerConfig(path string) (*StigmerConfig, error) {
	// Default to Stigmer.yaml in current directory
	if path == "" || path == DefaultStigmerConfigFilename {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, errors.Wrap(err, "failed to get current directory")
		}
		path = filepath.Join(cwd, DefaultStigmerConfigFilename)
	} else {
		// If path is a directory, append Stigmer.yaml
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			path = filepath.Join(path, DefaultStigmerConfigFilename)
		}
	}

	// Check if file exists
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, fmt.Errorf("Stigmer.yaml not found in current directory\n\n"+
			"This is not a Stigmer project directory.\n\n"+
			"To initialize a new Stigmer project:\n"+
			"  stigmer new\n\n"+
			"Or, if you have a Stigmer.yaml in another directory:\n"+
			"  stigmer apply --config /path/to/Stigmer.yaml")
	}

	// Read file
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read Stigmer.yaml")
	}

	// Parse YAML
	var config StigmerConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, errors.Wrap(err, "failed to parse Stigmer.yaml")
	}

	// Store base directory (directory containing Stigmer.yaml)
	config.BaseDir = filepath.Dir(path)

	// Validate required fields
	if err := config.Validate(); err != nil {
		return nil, err
	}

	// Set defaults
	config.SetDefaults()

	return &config, nil
}

// Validate checks that required fields are set and values are valid
func (c *StigmerConfig) Validate() error {
	if c.Name == "" {
		return errors.New("Stigmer.yaml: 'name' is required")
	}

	if c.Runtime == "" {
		return errors.New("Stigmer.yaml: 'runtime' is required")
	}

	// Currently only go is supported
	if c.Runtime != "go" {
		return fmt.Errorf("Stigmer.yaml: unsupported runtime '%s' (currently supported: go)", c.Runtime)
	}

	return nil
}

// SetDefaults sets default values for optional fields
func (c *StigmerConfig) SetDefaults() {
	if c.Main == "" {
		c.Main = "main.go"
	}
}

// GetMainFilePath returns the absolute path to the main entry point file
func (c *StigmerConfig) GetMainFilePath() (string, error) {
	// If main is already absolute, return as-is
	if filepath.IsAbs(c.Main) {
		return c.Main, nil
	}

	// Otherwise, resolve relative to BaseDir (where Stigmer.yaml is located)
	// If BaseDir is not set, fall back to current directory
	baseDir := c.BaseDir
	if baseDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return "", errors.Wrap(err, "failed to get current directory")
		}
		baseDir = cwd
	}

	return filepath.Join(baseDir, c.Main), nil
}

// InStigmerProjectDirectory checks if the current directory contains a Stigmer.yaml file
func InStigmerProjectDirectory() bool {
	cwd, err := os.Getwd()
	if err != nil {
		return false
	}

	stigmerPath := filepath.Join(cwd, DefaultStigmerConfigFilename)
	_, err = os.Stat(stigmerPath)
	return err == nil
}

// WriteStigmerConfig writes a StigmerConfig to the specified path
func WriteStigmerConfig(path string, config *StigmerConfig) error {
	if path == "" {
		path = DefaultStigmerConfigFilename
	}

	// Marshal to YAML
	data, err := yaml.Marshal(config)
	if err != nil {
		return errors.Wrap(err, "failed to marshal Stigmer.yaml")
	}

	// Write to file
	if err := os.WriteFile(path, data, 0644); err != nil {
		return errors.Wrap(err, "failed to write Stigmer.yaml")
	}

	return nil
}
