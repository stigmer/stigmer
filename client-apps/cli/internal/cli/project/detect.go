// Package project provides CLI utilities for managing Project resources.
// This file implements track detection to determine CLI operation mode.
package project

import (
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	projectv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/project/v1"
)

// =============================================================================
// Constants
// =============================================================================

const (
	// ConfigFileName is the expected project configuration filename.
	// Only lowercase is supported - STIGMER.yaml or other variants are ignored.
	ConfigFileName = "stigmer.yaml"

	// DefaultMaxDepth is the default maximum number of parent directories
	// to traverse when searching for stigmer.yaml.
	DefaultMaxDepth = 10
)

// =============================================================================
// Track Type
// =============================================================================

// Track represents the CLI operation mode determined by track detection.
// The track determines how resources are applied and managed.
type Track string

const (
	// TrackAtomic indicates no stigmer.yaml was found.
	// In this mode, resources are applied directly without project context.
	// Example: stigmer apply -f agent.yaml
	TrackAtomic Track = "atomic"

	// TrackDeclarative indicates a stigmer.yaml was found without an entry_point.
	// In this mode, the CLI scans the project directory for YAML resource files,
	// applies each individually, and tracks project membership for reconciliation.
	// Example: stigmer apply (scans directory, applies resources, updates project)
	TrackDeclarative Track = "declarative"

	// TrackProject indicates a stigmer.yaml was found with an entry_point set.
	// In this mode, SDK synthesis executes the entry point to generate resources.
	// Example: stigmer apply (runs SDK entry point, synthesizes resources)
	TrackProject Track = "project"
)

// String returns the string representation of the track.
func (t Track) String() string {
	return string(t)
}

// =============================================================================
// Detection Options and Result
// =============================================================================

// DetectOptions configures the track detection behavior.
type DetectOptions struct {
	// StartDir is the directory to begin detection from.
	// If empty, the current working directory is used.
	StartDir string

	// MaxDepth limits how many parent directories to traverse.
	// If zero, DefaultMaxDepth (10) is used.
	// Set to 1 to only check the start directory without walking up.
	MaxDepth int
}

// DetectResult contains the outcome of track detection.
type DetectResult struct {
	// Track indicates the detected CLI operation mode.
	Track Track

	// ConfigPath is the absolute path to the discovered stigmer.yaml.
	// Empty when Track is TrackAtomic.
	ConfigPath string

	// ConfigDir is the directory containing the discovered stigmer.yaml.
	// Empty when Track is TrackAtomic.
	ConfigDir string

	// Project is the loaded and validated Project configuration.
	// Nil when Track is TrackAtomic.
	Project *projectv1.Project
}

// =============================================================================
// Track Detection
// =============================================================================

// DetectTrack determines the CLI operation mode by walking up the directory
// tree from StartDir looking for a valid stigmer.yaml file.
//
// Detection algorithm:
//  1. Start from StartDir (or cwd if empty)
//  2. Check if stigmer.yaml exists in current directory
//  3. If found, load and validate it
//  4. If valid and entry_point is set, return TrackProject (SDK)
//  5. If valid and entry_point is empty, return TrackDeclarative
//  6. If invalid, return an error (not a silent fallback to Atomic)
//  7. If not found, walk up to parent directory
//  8. Repeat until filesystem root or MaxDepth is reached
//  9. If no stigmer.yaml found, return TrackAtomic
//
// Error philosophy:
//   - No stigmer.yaml found → TrackAtomic (expected for single-resource workflows)
//   - Invalid stigmer.yaml → Error (user intent was Project, help them fix it)
//   - Permission denied → Error with guidance
func DetectTrack(opts *DetectOptions) (*DetectResult, error) {
	normalized, err := normalizeOptions(opts)
	if err != nil {
		return nil, err
	}

	configPath, found, err := walkUpForConfig(normalized.StartDir, normalized.MaxDepth)
	if err != nil {
		return nil, err
	}

	if !found {
		return &DetectResult{
			Track: TrackAtomic,
		}, nil
	}

	// Found stigmer.yaml - load and validate it
	loadResult, err := Load(&LoadOptions{FilePath: configPath})
	if err != nil {
		return nil, errors.Wrapf(err,
			"invalid project configuration in %s\n\n"+
				"The stigmer.yaml file exists but contains errors.\n"+
				"Fix the issues above or remove the file to use Atomic Track",
			configPath)
	}

	track := TrackDeclarative
	if loadResult.Project.Spec != nil && loadResult.Project.Spec.EntryPoint != "" {
		track = TrackProject
	}

	return &DetectResult{
		Track:      track,
		ConfigPath: configPath,
		ConfigDir:  filepath.Dir(configPath),
		Project:    loadResult.Project,
	}, nil
}

// =============================================================================
// Internal Functions
// =============================================================================

// normalizeOptions fills in default values and validates the options.
func normalizeOptions(opts *DetectOptions) (*DetectOptions, error) {
	if opts == nil {
		opts = &DetectOptions{}
	}

	result := &DetectOptions{
		StartDir: opts.StartDir,
		MaxDepth: opts.MaxDepth,
	}

	// Default to current working directory
	if result.StartDir == "" {
		cwd, err := os.Getwd()
		if err != nil {
			return nil, errors.Wrap(err, "failed to get current working directory")
		}
		result.StartDir = cwd
	}

	// Resolve to absolute path
	absPath, err := filepath.Abs(result.StartDir)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to resolve absolute path for %s", result.StartDir)
	}
	result.StartDir = absPath

	// Validate directory exists and is accessible
	info, err := os.Stat(result.StartDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, errors.Errorf("directory does not exist: %s", result.StartDir)
		}
		if os.IsPermission(err) {
			return nil, errors.Errorf(
				"permission denied accessing directory: %s\n\n"+
					"Check that you have read access to this directory",
				result.StartDir)
		}
		return nil, errors.Wrapf(err, "failed to access directory %s", result.StartDir)
	}
	if !info.IsDir() {
		return nil, errors.Errorf("not a directory: %s", result.StartDir)
	}

	// Default max depth
	if result.MaxDepth <= 0 {
		result.MaxDepth = DefaultMaxDepth
	}

	return result, nil
}

// walkUpForConfig walks up the directory tree looking for stigmer.yaml.
// Returns (configPath, found, error).
func walkUpForConfig(startDir string, maxDepth int) (string, bool, error) {
	currentDir := startDir

	for depth := 0; depth < maxDepth; depth++ {
		configPath := filepath.Join(currentDir, ConfigFileName)

		// Check if stigmer.yaml exists
		info, err := os.Stat(configPath)
		if err == nil && !info.IsDir() {
			// Found a file (not a directory) named stigmer.yaml
			return configPath, true, nil
		}
		if err != nil && !os.IsNotExist(err) {
			// Error other than "not exists" - might be permission issue
			if os.IsPermission(err) {
				return "", false, errors.Errorf(
					"permission denied reading %s\n\n"+
						"Check that you have read access to this file",
					configPath)
			}
			return "", false, errors.Wrapf(err, "failed to check for %s", configPath)
		}

		// Not found in this directory - try parent
		if isFilesystemRoot(currentDir) {
			// Reached filesystem root, stop walking
			break
		}

		parentDir := filepath.Dir(currentDir)
		if parentDir == currentDir {
			// Safety check - filepath.Dir returns same path for root
			break
		}
		currentDir = parentDir
	}

	// No stigmer.yaml found
	return "", false, nil
}

// isFilesystemRoot checks if the given path is the filesystem root.
// Works correctly on Unix (/) and Windows (C:\, D:\, etc.).
func isFilesystemRoot(path string) bool {
	// filepath.Dir of root returns root itself
	parent := filepath.Dir(path)
	return parent == path
}
