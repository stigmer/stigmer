package envfile

import (
	executioncontextv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/executioncontext/v1"
)

// MergeEnvSources merges multiple environment sources with precedence.
// Later sources override earlier sources.
//
// Example:
//
//	merged := MergeEnvSources(fileEnv1, fileEnv2, flagEnv)
//
// In this case, flagEnv values take precedence over fileEnv2,
// which takes precedence over fileEnv1.
func MergeEnvSources(sources ...EnvMap) EnvMap {
	if len(sources) == 0 {
		return make(EnvMap)
	}

	result := make(EnvMap)

	for _, source := range sources {
		if source == nil {
			continue
		}
		for key, value := range source {
			if value != nil {
				result[key] = value
			}
		}
	}

	return result
}

// LoadAndMergeWithSecrets loads environment files and secrets with proper precedence.
// This is the Pulumi-style approach where env and secrets are handled separately.
//
// Precedence (highest to lowest):
//  1. envFlags (--env) and secretFlags (--secret) - inline flags have highest precedence
//  2. Later envFiles (--env-file) and secretFiles (--secret-file)
//  3. Earlier envFiles and secretFiles
//
// Parameters:
//   - envFiles: paths to .env files (all values are non-secrets)
//   - secretFiles: paths to secret files (all values are secrets)
//   - envFlags: --env flag values (non-secrets)
//   - secretFlags: --secret flag values (secrets)
//
// Returns the merged environment map or an error if any file/flag fails to parse.
func LoadAndMergeWithSecrets(envFiles, secretFiles, envFlags, secretFlags []string) (EnvMap, error) {
	var sources []EnvMap

	// Process env files and secret files in interleaved order by their original positions
	// For simplicity, we process: env files first, then secret files, then flags
	// This maintains the precedence: earlier files < later files < flags

	// Load env files (non-secrets)
	for _, path := range envFiles {
		fileEnv, err := ParseFile(path)
		if err != nil {
			return nil, err
		}
		sources = append(sources, fileEnv)
	}

	// Load secret files (all values are secrets)
	for _, path := range secretFiles {
		fileSecrets, err := ParseFileAsSecrets(path)
		if err != nil {
			return nil, err
		}
		sources = append(sources, fileSecrets)
	}

	// Parse env flags (non-secrets, higher precedence than files)
	if len(envFlags) > 0 {
		flagEnv, err := ParseFlags(envFlags)
		if err != nil {
			return nil, err
		}
		sources = append(sources, flagEnv)
	}

	// Parse secret flags (secrets, highest precedence)
	if len(secretFlags) > 0 {
		flagSecrets, err := ParseFlagsAsSecrets(secretFlags)
		if err != nil {
			return nil, err
		}
		sources = append(sources, flagSecrets)
	}

	return MergeEnvSources(sources...), nil
}

// CopyEnvMap creates a deep copy of an environment map.
func CopyEnvMap(source EnvMap) EnvMap {
	if source == nil {
		return nil
	}

	result := make(EnvMap, len(source))
	for key, value := range source {
		if value != nil {
			result[key] = &executioncontextv1.ExecutionValue{
				Value:    value.Value,
				IsSecret: value.IsSecret,
			}
		}
	}

	return result
}
