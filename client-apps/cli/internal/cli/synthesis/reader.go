package synthesis

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/pkg/errors"
	"google.golang.org/protobuf/proto"
)

// ReadFromDirectory reads all synthesized resources from the output directory.
//
// The SDK writes:
//   - skill-0.pb, skill-1.pb, ...
//   - agent-0.pb, agent-1.pb, ...
//   - workflow-0.pb, workflow-1.pb, ...
//   - dependencies.json
//
// This function reads all these files and returns a Result.
func ReadFromDirectory(outputDir string) (*Result, error) {
	result := &Result{
		Skills:    make([]*skillv1.Skill, 0),
		Agents:    make([]*agentv1.Agent, 0),
		Workflows: make([]*workflowv1.Workflow, 0),
	}

	// Read skills (skill-0.pb, skill-1.pb, ...)
	skills, err := readProtoFiles[*skillv1.Skill](outputDir, "skill-*.pb")
	if err != nil {
		return nil, errors.Wrap(err, "failed to read skills")
	}
	result.Skills = skills

	// Read agents (agent-0.pb, agent-1.pb, ...)
	agents, err := readProtoFiles[*agentv1.Agent](outputDir, "agent-*.pb")
	if err != nil {
		return nil, errors.Wrap(err, "failed to read agents")
	}
	result.Agents = agents

	// Read workflows (workflow-0.pb, workflow-1.pb, ...)
	workflows, err := readProtoFiles[*workflowv1.Workflow](outputDir, "workflow-*.pb")
	if err != nil {
		return nil, errors.Wrap(err, "failed to read workflows")
	}
	result.Workflows = workflows

	// Read dependencies.json
	deps, err := readDependencies(outputDir)
	if err != nil {
		// Dependencies are optional - if file doesn't exist, that's okay
		if !os.IsNotExist(err) {
			return nil, errors.Wrap(err, "failed to read dependencies")
		}
		deps = make(map[string][]string)
	}
	result.Dependencies = deps

	// Validate that at least one resource exists
	if result.TotalResources() == 0 {
		return nil, errors.New("no resources found in synthesis output")
	}

	return result, nil
}

// readProtoFiles reads all proto files matching the pattern and returns them in order.
//
// Generic function that works with any proto message type.
func readProtoFiles[T proto.Message](dir, pattern string) ([]T, error) {
	// Find all files matching pattern
	matches, err := filepath.Glob(filepath.Join(dir, pattern))
	if err != nil {
		return nil, errors.Wrapf(err, "failed to glob pattern %s", pattern)
	}

	// Sort to maintain order (skill-0.pb, skill-1.pb, ...)
	sort.Strings(matches)

	results := make([]T, 0, len(matches))
	for _, path := range matches {
		// Read file
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, errors.Wrapf(err, "failed to read %s", path)
		}

		// Create new instance of the proto type
		var msg T
		// Use reflection to create a new instance
		msg = msg.ProtoReflect().New().Interface().(T)

		// Unmarshal
		if err := proto.Unmarshal(data, msg); err != nil {
			return nil, errors.Wrapf(err, "failed to unmarshal %s", path)
		}

		results = append(results, msg)
	}

	return results, nil
}

// readDependencies reads the dependencies.json file.
func readDependencies(outputDir string) (map[string][]string, error) {
	depsPath := filepath.Join(outputDir, "dependencies.json")

	data, err := os.ReadFile(depsPath)
	if err != nil {
		return nil, err
	}

	var deps map[string][]string
	if err := json.Unmarshal(data, &deps); err != nil {
		return nil, errors.Wrap(err, "failed to parse dependencies.json")
	}

	return deps, nil
}

// GetResourceID generates a resource ID from a proto message.
//
// Format:
//   - Skills: "skill:{slug}"
//   - Agents: "agent:{slug}"
//   - Workflows: "workflow:{slug}"
func GetResourceID(msg proto.Message) string {
	switch m := msg.(type) {
	case *skillv1.Skill:
		slug := m.GetMetadata().GetSlug()
		if slug == "" {
			slug = m.GetMetadata().GetName()
		}
		return fmt.Sprintf("skill:%s", strings.ToLower(slug))
	case *agentv1.Agent:
		slug := m.GetMetadata().GetSlug()
		if slug == "" {
			slug = m.GetMetadata().GetName()
		}
		return fmt.Sprintf("agent:%s", strings.ToLower(slug))
	case *workflowv1.Workflow:
		// Workflow slug/name extraction depends on proto structure
		if m.GetSpec() != nil && m.GetSpec().GetDocument() != nil {
			name := m.GetSpec().GetDocument().GetName()
			return fmt.Sprintf("workflow:%s", strings.ToLower(name))
		}
		return "workflow:unknown"
	default:
		return "unknown"
	}
}
