package envfile

import (
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
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

// LoadAndMerge loads multiple env files and merges them with flag values.
// Files are processed in order (earlier files have lower precedence).
// Flag values have the highest precedence.
//
// Parameters:
//   - filePaths: paths to .env files (processed in order)
//   - flagValues: --env flag values (highest precedence)
//
// Returns the merged environment map or an error if any file fails to load.
func LoadAndMerge(filePaths []string, flagValues []string) (EnvMap, error) {
	var sources []EnvMap

	// Load each file in order
	for _, path := range filePaths {
		fileEnv, err := ParseFile(path)
		if err != nil {
			return nil, err
		}
		sources = append(sources, fileEnv)
	}

	// Parse flag values (highest precedence)
	if len(flagValues) > 0 {
		flagEnv, err := ParseFlags(flagValues)
		if err != nil {
			return nil, err
		}
		sources = append(sources, flagEnv)
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
