package agent

import (
	"fmt"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer/naming"
	"github.com/stigmer/stigmer/sdk/go/subagent"
)

// ToProto converts the SDK Agent to a platform Agent proto message.
//
// This method creates a complete Agent proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK agent to proto AgentSpec
//
// Example:
//
//	agent, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{
//	    Instructions: "Review code",
//	})
//	agent.AddSkillRef(skillref.Platform("coding-best-practices"))
//	proto, err := agent.ToProto()
func (a *Agent) ToProto() (*agentv1.Agent, error) {
	// Convert MCP servers
	mcpServers, err := convertMCPServers(a.MCPServers)
	if err != nil {
		return nil, fmt.Errorf("failed to convert MCP servers: %w", err)
	}

	// Convert sub-agents
	subAgents, err := convertSubAgents(a.SubAgents)
	if err != nil {
		return nil, fmt.Errorf("failed to convert sub-agents: %w", err)
	}

	// Convert environment variables
	envSpec, err := convertEnvironmentVariables(a.EnvironmentVariables)
	if err != nil {
		return nil, fmt.Errorf("failed to convert environment variables: %w", err)
	}

	// Auto-generate slug if empty
	slug := a.Slug
	if slug == "" {
		slug = naming.GenerateSlug(a.Name)
	}

	// Build metadata
	metadata := &apiresource.ApiResourceMetadata{
		Name:        a.Name,
		Slug:        slug,
		Annotations: SDKAnnotations(),
	}

	// Build complete Agent proto
	// SkillRefs are already proto types - no conversion needed
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata:   metadata,
		Spec: &agentv1.AgentSpec{
			Description:  a.Description,
			IconUrl:      a.IconURL,
			Instructions: a.Instructions,
			SkillRefs:    a.SkillRefs,
			McpServers:   mcpServers,
			SubAgents:    subAgents,
			EnvSpec:      envSpec,
		},
	}, nil
}

// convertMCPServers converts SDK MCP servers to proto MCP server definitions.
func convertMCPServers(servers []mcpserver.MCPServer) ([]*agentv1.McpServerDefinition, error) {
	if len(servers) == 0 {
		return []*agentv1.McpServerDefinition{}, nil
	}

	defs := make([]*agentv1.McpServerDefinition, 0, len(servers))
	for _, server := range servers {
		def := &agentv1.McpServerDefinition{
			Name:         server.Name(),
			EnabledTools: server.EnabledTools(),
		}

		// Convert server type-specific configuration
		switch server.Type() {
		case mcpserver.TypeStdio:
			stdioServer, ok := server.(*mcpserver.StdioServer)
			if !ok {
				return nil, fmt.Errorf("server %q: type mismatch - expected StdioServer", server.Name())
			}
			def.ServerType = &agentv1.McpServerDefinition_Stdio{
				Stdio: &agentv1.StdioServer{
					Command:         stdioServer.Command(),
					Args:            stdioServer.Args(),
					EnvPlaceholders: stdioServer.EnvPlaceholders(),
					WorkingDir:      stdioServer.WorkingDir(),
				},
			}

		case mcpserver.TypeHTTP:
			httpServer, ok := server.(*mcpserver.HTTPServer)
			if !ok {
				return nil, fmt.Errorf("server %q: type mismatch - expected HTTPServer", server.Name())
			}
			def.ServerType = &agentv1.McpServerDefinition_Http{
				Http: &agentv1.HttpServer{
					Url:            httpServer.URL(),
					Headers:        httpServer.Headers(),
					QueryParams:    httpServer.QueryParams(),
					TimeoutSeconds: httpServer.TimeoutSeconds(),
				},
			}

		case mcpserver.TypeDocker:
			dockerServer, ok := server.(*mcpserver.DockerServer)
			if !ok {
				return nil, fmt.Errorf("server %q: type mismatch - expected DockerServer", server.Name())
			}

			// Convert volume mounts (types.VolumeMount has same fields as agentv1.VolumeMount)
			volumes := make([]*agentv1.VolumeMount, 0, len(dockerServer.Volumes()))
			for _, vol := range dockerServer.Volumes() {
				if vol != nil {
					volumes = append(volumes, &agentv1.VolumeMount{
						HostPath:      vol.HostPath,
						ContainerPath: vol.ContainerPath,
						ReadOnly:      vol.ReadOnly,
					})
				}
			}

			// Convert port mappings (types.PortMapping has same fields as agentv1.PortMapping)
			ports := make([]*agentv1.PortMapping, 0, len(dockerServer.Ports()))
			for _, port := range dockerServer.Ports() {
				if port != nil {
					ports = append(ports, &agentv1.PortMapping{
						HostPort:      port.HostPort,
						ContainerPort: port.ContainerPort,
						Protocol:      port.Protocol,
					})
				}
			}

			def.ServerType = &agentv1.McpServerDefinition_Docker{
				Docker: &agentv1.DockerServer{
					Image:           dockerServer.Image(),
					Args:            dockerServer.Args(),
					EnvPlaceholders: dockerServer.EnvPlaceholders(),
					Volumes:         volumes,
					Network:         dockerServer.Network(),
					Ports:           ports,
					ContainerName:   dockerServer.ContainerName(),
				},
			}

		default:
			return nil, fmt.Errorf("server %q: unknown server type %v", server.Name(), server.Type())
		}

		defs = append(defs, def)
	}

	return defs, nil
}

// convertSubAgents converts SDK sub-agents to proto sub-agents.
func convertSubAgents(subAgents []subagent.SubAgent) ([]*agentv1.SubAgent, error) {
	if len(subAgents) == 0 {
		return []*agentv1.SubAgent{}, nil
	}

	protoSubAgents := make([]*agentv1.SubAgent, 0, len(subAgents))
	for _, sa := range subAgents {
		if sa.IsInline() {
			// Convert tool selections map to proto format
			toolSelections := make(map[string]*agentv1.McpToolSelection)
			for serverName, selection := range sa.ToolSelections() {
				if selection != nil {
					toolSelections[serverName] = &agentv1.McpToolSelection{
						EnabledTools: selection.EnabledTools,
					}
				}
			}

			protoSubAgents = append(protoSubAgents, &agentv1.SubAgent{
				AgentReference: &agentv1.SubAgent_InlineSpec{
					InlineSpec: &agentv1.InlineSubAgentSpec{
						Name:              sa.Name(),
						Description:       sa.Description(),
						Instructions:      sa.Instructions(),
						McpServers:        sa.MCPServerNames(),
						McpToolSelections: toolSelections,
						SkillRefs:         sa.SkillRefs(), // Already proto types - no conversion needed
					},
				},
			})
		} else if sa.IsReference() {
			// Convert referenced sub-agent
			protoSubAgents = append(protoSubAgents, &agentv1.SubAgent{
				AgentReference: &agentv1.SubAgent_AgentInstanceRefs{
					AgentInstanceRefs: &apiresource.ApiResourceReference{
						Slug:  sa.AgentInstanceID(),
						Kind:  apiresourcekind.ApiResourceKind_agent_instance,
						Scope: apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified,
					},
				},
			})
		} else {
			return nil, fmt.Errorf("sub-agent %q: unknown type (neither inline nor reference)", sa.Name())
		}
	}

	return protoSubAgents, nil
}

// convertEnvironmentVariables converts SDK environment variables to proto EnvironmentSpec.
func convertEnvironmentVariables(vars []environment.Variable) (*environmentv1.EnvironmentSpec, error) {
	if len(vars) == 0 {
		return nil, nil
	}

	// Build environment data map
	envData := make(map[string]*environmentv1.EnvironmentValue)
	for _, v := range vars {
		envData[v.Name] = &environmentv1.EnvironmentValue{
			Value:       v.DefaultValue, // Use default value as the template value
			IsSecret:    v.IsSecret,
			Description: v.Description,
		}
	}

	return &environmentv1.EnvironmentSpec{
		Description: fmt.Sprintf("Environment variables for agent (%d variables)", len(vars)),
		Data:        envData,
	}, nil
}
