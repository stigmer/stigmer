package synth

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	// Import Buf-generated proto packages
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	sdk "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/sdk"

	// Import SDK types
	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

const (
	// SDKLanguage identifies this SDK as the Go implementation
	SDKLanguage = "go"

	// SDKVersion is the current version of the Go SDK
	// TODO: Read from build info or version file
	SDKVersion = "0.1.0"
)

// ToManifest converts one or more SDK Agents to an AgentManifest proto message.
//
// This is the core converter that transforms the Go SDK's type-safe agent
// configurations into the protocol buffer format that the CLI expects.
//
// Supports multiple agents: Pass one or more agent interfaces.
// Each agent is converted to an AgentBlueprint and added to the manifest.
//
// Conversion mapping:
//   - agent.Agent → agentv1.AgentBlueprint
//   - skill.Skill → agentv1.ManifestSkill (with unique ID)
//   - mcpserver.MCPServer → agentv1.ManifestMcpServer
//   - subagent.SubAgent → agentv1.ManifestSubAgent
//   - environment.Variable → agentv1.ManifestEnvironmentVariable
//
// Returns an error if any nested conversion fails.
func ToManifest(agentInterfaces ...interface{}) (*agentv1.AgentManifest, error) {
	if len(agentInterfaces) == 0 {
		return nil, fmt.Errorf("at least one agent is required")
	}

	// Create SDK metadata (shared across all agents)
	metadata := &sdk.SdkMetadata{
		Language:    SDKLanguage,
		Version:     SDKVersion,
		GeneratedAt: time.Now().Unix(),
		// ProjectName will be set by CLI from stigmer.json or inferred
	}

	// Create manifest with empty agents list
	manifest := &agentv1.AgentManifest{
		SdkMetadata: metadata,
		Agents:      []*agentv1.AgentBlueprint{},
	}

	// Convert each agent
	for agentIdx, agentInterface := range agentInterfaces {
		// Type assert to *agent.Agent
		a, ok := agentInterface.(*agent.Agent)
		if !ok {
			return nil, fmt.Errorf("agent[%d]: invalid type %T, expected *agent.Agent", agentIdx, agentInterface)
		}

		// Create agent blueprint
		blueprint := &agentv1.AgentBlueprint{
			Name:         a.Name,
			Instructions: a.Instructions,
			Description:  a.Description,
			IconUrl:      a.IconURL,
		}

		// Convert skills
		for i, s := range a.Skills {
			manifestSkill, err := skillToManifest(s)
			if err != nil {
				return nil, fmt.Errorf("agent[%d] %s: converting skill[%d]: %w", agentIdx, a.Name, i, err)
			}
			blueprint.Skills = append(blueprint.Skills, manifestSkill)
		}

		// Convert MCP servers
		for i, mcp := range a.MCPServers {
			manifestMCP, err := mcpServerToManifest(mcp)
			if err != nil {
				return nil, fmt.Errorf("agent[%d] %s: converting mcp_server[%d]: %w", agentIdx, a.Name, i, err)
			}
			blueprint.McpServers = append(blueprint.McpServers, manifestMCP)
		}

		// Convert sub-agents
		for i, sub := range a.SubAgents {
			manifestSub, err := subAgentToManifest(sub)
			if err != nil {
				return nil, fmt.Errorf("agent[%d] %s: converting sub_agent[%d]: %w", agentIdx, a.Name, i, err)
			}
			blueprint.SubAgents = append(blueprint.SubAgents, manifestSub)
		}

		// Convert environment variables
		for i, env := range a.EnvironmentVariables {
			manifestEnv, err := environmentVariableToManifest(env)
			if err != nil {
				return nil, fmt.Errorf("agent[%d] %s: converting environment_variable[%d]: %w", agentIdx, a.Name, i, err)
			}
			blueprint.EnvironmentVariables = append(blueprint.EnvironmentVariables, manifestEnv)
		}

		// Add blueprint to manifest
		manifest.Agents = append(manifest.Agents, blueprint)
	}

	return manifest, nil
}

// skillToManifest converts a skill.Skill to a ManifestSkill proto.
func skillToManifest(s skill.Skill) (*agentv1.ManifestSkill, error) {
	manifestSkill := &agentv1.ManifestSkill{
		Id: uuid.New().String(),
	}

	// Determine skill source type and convert accordingly
	if s.IsPlatformReference() {
		manifestSkill.Source = &agentv1.ManifestSkill_Platform{
			Platform: &agentv1.PlatformSkillReference{
				Name: s.Slug, // Use Slug field directly for platform references
			},
		}
	} else if s.IsOrganizationReference() {
		manifestSkill.Source = &agentv1.ManifestSkill_Org{
			Org: &agentv1.OrgSkillReference{
				Name: s.Slug,          // Use Slug field directly for org references
				Org:  s.Repository(), // Organization name
			},
		}
	} else if s.IsInline {
		manifestSkill.Source = &agentv1.ManifestSkill_Inline{
			Inline: &agentv1.InlineSkillDefinition{
				Name:            s.Name,            // Use Name field directly for inline
				Description:     s.GetDescription(), // Use accessor method
				MarkdownContent: s.Markdown(),
			},
		}
	} else {
		return nil, fmt.Errorf("skill has unknown source type")
	}

	return manifestSkill, nil
}

// mcpServerToManifest converts an mcpserver.MCPServer to a ManifestMcpServer proto.
func mcpServerToManifest(mcp mcpserver.MCPServer) (*agentv1.ManifestMcpServer, error) {
	manifestMCP := &agentv1.ManifestMcpServer{
		Name:         mcp.Name(),
		EnabledTools: mcp.EnabledTools(),
	}

	// Convert based on server type
	// Type assert to concrete types to access specific methods
	switch mcp.Type() {
	case mcpserver.TypeStdio:
		stdio, ok := mcp.(*mcpserver.StdioServer)
		if !ok {
			return nil, fmt.Errorf("expected *StdioServer, got %T", mcp)
		}
		manifestMCP.ServerType = &agentv1.ManifestMcpServer_Stdio{
			Stdio: &agentv1.ManifestStdioServer{
				Command:         stdio.Command(),
				Args:            stdio.Args(),
				EnvPlaceholders: stdio.EnvPlaceholders(),
				WorkingDir:      stdio.WorkingDir(),
			},
		}

	case mcpserver.TypeHTTP:
		http, ok := mcp.(*mcpserver.HTTPServer)
		if !ok {
			return nil, fmt.Errorf("expected *HTTPServer, got %T", mcp)
		}
		manifestMCP.ServerType = &agentv1.ManifestMcpServer_Http{
			Http: &agentv1.ManifestHttpServer{
				Url:            http.URL(),
				Headers:        http.Headers(),
				QueryParams:    http.QueryParams(),
				TimeoutSeconds: http.TimeoutSeconds(),
			},
		}

	case mcpserver.TypeDocker:
		docker, ok := mcp.(*mcpserver.DockerServer)
		if !ok {
			return nil, fmt.Errorf("expected *DockerServer, got %T", mcp)
		}

		// Convert volume mounts
		var volumes []*agentv1.ManifestVolumeMount
		for _, v := range docker.Volumes() {
			volumes = append(volumes, &agentv1.ManifestVolumeMount{
				HostPath:      v.HostPath,
				ContainerPath: v.ContainerPath,
				ReadOnly:      v.ReadOnly,
			})
		}

		// Convert port mappings
		var ports []*agentv1.ManifestPortMapping
		for _, p := range docker.Ports() {
			ports = append(ports, &agentv1.ManifestPortMapping{
				HostPort:      p.HostPort,
				ContainerPort: p.ContainerPort,
				Protocol:      p.Protocol,
			})
		}

		manifestMCP.ServerType = &agentv1.ManifestMcpServer_Docker{
			Docker: &agentv1.ManifestDockerServer{
				Image:           docker.Image(),
				Args:            docker.Args(),
				EnvPlaceholders: docker.EnvPlaceholders(),
				Volumes:         volumes,
				Ports:           ports,
				Network:         docker.Network(),
				ContainerName:   docker.ContainerName(),
			},
		}

	default:
		return nil, fmt.Errorf("unknown MCP server type: %s", mcp.Type())
	}

	return manifestMCP, nil
}

// subAgentToManifest converts a subagent.SubAgent to a ManifestSubAgent proto.
func subAgentToManifest(sub subagent.SubAgent) (*agentv1.ManifestSubAgent, error) {
	manifestSub := &agentv1.ManifestSubAgent{}

	if sub.IsInline() {
		// Convert tool selections
		var toolSelections []*agentv1.ManifestToolSelection
		for mcpName, tools := range sub.ToolSelections() {
			toolSelections = append(toolSelections, &agentv1.ManifestToolSelection{
				McpServerName: mcpName,
				Tools:         tools,
			})
		}

		// Convert nested skills
		var skills []*agentv1.ManifestSkill
		for i, s := range sub.Skills() {
			manifestSkill, err := skillToManifest(s)
			if err != nil {
				return nil, fmt.Errorf("converting sub-agent skill[%d]: %w", i, err)
			}
			skills = append(skills, manifestSkill)
		}

		manifestSub.Source = &agentv1.ManifestSubAgent_Inline{
			Inline: &agentv1.InlineSubAgentDefinition{
				Name:           sub.Name(),
				Instructions:   sub.Instructions(),
				Description:    sub.Description(),
				McpServerNames: sub.MCPServerNames(),
				ToolSelections: toolSelections,
				Skills:         skills,
			},
		}
	} else if sub.IsReference() {
		manifestSub.Source = &agentv1.ManifestSubAgent_Reference{
			Reference: &agentv1.ReferencedSubAgent{
				AgentInstanceId: sub.AgentInstanceID(),
			},
		}
	} else {
		return nil, fmt.Errorf("sub-agent has unknown source type")
	}

	return manifestSub, nil
}

// environmentVariableToManifest converts an environment.Variable to a ManifestEnvironmentVariable proto.
func environmentVariableToManifest(env environment.Variable) (*agentv1.ManifestEnvironmentVariable, error) {
	// environment.Variable fields are exported, so access them directly
	return &agentv1.ManifestEnvironmentVariable{
		Name:         env.Name,
		Description:  env.Description,
		IsSecret:     env.IsSecret,
		DefaultValue: env.DefaultValue,
		Required:     env.Required,
	}, nil
}
