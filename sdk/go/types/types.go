// Package types contains shared types used across SDK packages.
//
// This package exists to break circular dependencies between agent, skill, and workflow packages.
// All Args structs can reference types from this package without creating import cycles.
package types

import (
	"google.golang.org/protobuf/types/known/structpb"
)

// ApiResourceReference is a generic reference to any API resource by scope, org, and name.
//
// Used across resources to reference other resources (e.g., Environment, Agent, etc.)
type ApiResourceReference struct {
	// Owner scope of the referenced resource
	Scope string `json:"scope,omitempty"`
	// Organization ID (required if scope = organization)
	Org  string `json:"org,omitempty"`
	Kind string `json:"kind,omitempty"`
	// Resource slug (user-friendly name, not ID)
	Slug string `json:"slug,omitempty"`
}

// FromProto converts google.protobuf.Struct to ApiResourceReference.
func (c *ApiResourceReference) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["scope"]; ok {
		c.Scope = val.GetStringValue()
	}

	if val, ok := fields["org"]; ok {
		c.Org = val.GetStringValue()
	}

	if val, ok := fields["kind"]; ok {
		c.Kind = val.GetStringValue()
	}

	if val, ok := fields["slug"]; ok {
		c.Slug = val.GetStringValue()
	}

	return nil
}

// McpServerDefinition defines an MCP server that can be requested by an agent.
type McpServerDefinition struct {
	// Server name (unique identifier).
	Name string `json:"name,omitempty"`
	// Server transport type.
	Transport string `json:"transport,omitempty"`
	// Stdio server configuration (if transport = stdio).
	Stdio *StdioServer `json:"stdio,omitempty"`
	// Docker server configuration (if transport = docker).
	Docker *DockerServer `json:"docker,omitempty"`
	// HTTP server configuration (if transport = http).
	Http *HttpServer `json:"http,omitempty"`
	// Tool selection strategy.
	Tools *McpToolSelection `json:"tools,omitempty"`
}

// FromProto converts google.protobuf.Struct to McpServerDefinition.
func (c *McpServerDefinition) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["name"]; ok {
		c.Name = val.GetStringValue()
	}

	if val, ok := fields["transport"]; ok {
		c.Transport = val.GetStringValue()
	}

	if val, ok := fields["stdio"]; ok {
		c.Stdio = &StdioServer{}
		if err := c.Stdio.FromProto(val.GetStructValue()); err != nil {
			return err
		}
	}

	if val, ok := fields["docker"]; ok {
		c.Docker = &DockerServer{}
		if err := c.Docker.FromProto(val.GetStructValue()); err != nil {
			return err
		}
	}

	if val, ok := fields["http"]; ok {
		c.Http = &HttpServer{}
		if err := c.Http.FromProto(val.GetStructValue()); err != nil {
			return err
		}
	}

	if val, ok := fields["tools"]; ok {
		c.Tools = &McpToolSelection{}
		if err := c.Tools.FromProto(val.GetStructValue()); err != nil {
			return err
		}
	}

	return nil
}

// StdioServer defines an MCP server that runs as a subprocess.
type StdioServer struct {
	// Command to execute (e.g., "node", "python").
	Command string `json:"command,omitempty"`
	// Command arguments (e.g., ["/path/to/script.js", "--arg"]).
	Args []string `json:"args,omitempty"`
	// Environment variable placeholders that need values at instance level.
	EnvPlaceholders map[string]string `json:"envPlaceholders,omitempty"`
	// Working directory for the subprocess (optional).
	WorkingDir string `json:"workingDir,omitempty"`
}

// FromProto converts google.protobuf.Struct to StdioServer.
func (c *StdioServer) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["command"]; ok {
		c.Command = val.GetStringValue()
	}

	if val, ok := fields["args"]; ok {
		// TODO: Implement FromProto for array field Args
		_ = val // suppress unused variable warning
	}

	if val, ok := fields["envPlaceholders"]; ok {
		c.EnvPlaceholders = make(map[string]string)
		for k, v := range val.GetStructValue().GetFields() {
			c.EnvPlaceholders[k] = v.GetStringValue()
		}
	}

	if val, ok := fields["workingDir"]; ok {
		c.WorkingDir = val.GetStringValue()
	}

	return nil
}

// DockerServer defines an MCP server that runs in a Docker container.
type DockerServer struct {
	// Docker image name and tag.
	Image string `json:"image,omitempty"`
	// Container command arguments (optional).
	Args []string `json:"args,omitempty"`
	// Environment variable placeholders.
	EnvPlaceholders map[string]string `json:"envPlaceholders,omitempty"`
	// Volume mounts for the container (optional).
	Volumes []*VolumeMount `json:"volumes,omitempty"`
	// Docker network to attach the container to (optional).
	Network string `json:"network,omitempty"`
	// Port mappings for the container (optional).
	Ports []*PortMapping `json:"ports,omitempty"`
	// Container name (optional).
	ContainerName string `json:"containerName,omitempty"`
}

// FromProto converts google.protobuf.Struct to DockerServer.
func (c *DockerServer) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["image"]; ok {
		c.Image = val.GetStringValue()
	}

	if val, ok := fields["args"]; ok {
		// TODO: Implement FromProto for array field Args
		_ = val // suppress unused variable warning
	}

	if val, ok := fields["envPlaceholders"]; ok {
		c.EnvPlaceholders = make(map[string]string)
		for k, v := range val.GetStructValue().GetFields() {
			c.EnvPlaceholders[k] = v.GetStringValue()
		}
	}

	if val, ok := fields["volumes"]; ok {
		// TODO: Implement FromProto for array field Volumes
		_ = val // suppress unused variable warning
	}

	if val, ok := fields["network"]; ok {
		c.Network = val.GetStringValue()
	}

	if val, ok := fields["ports"]; ok {
		// TODO: Implement FromProto for array field Ports
		_ = val // suppress unused variable warning
	}

	if val, ok := fields["containerName"]; ok {
		c.ContainerName = val.GetStringValue()
	}

	return nil
}

// HttpServer defines an MCP server that communicates via HTTP.
type HttpServer struct {
	// Base URL of the HTTP server.
	Url string `json:"url,omitempty"`
	// HTTP headers to include in requests (optional).
	Headers map[string]string `json:"headers,omitempty"`
	// Authentication token placeholder (optional).
	AuthTokenPlaceholder string `json:"authTokenPlaceholder,omitempty"`
}

// FromProto converts google.protobuf.Struct to HttpServer.
func (c *HttpServer) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["url"]; ok {
		c.Url = val.GetStringValue()
	}

	if val, ok := fields["headers"]; ok {
		c.Headers = make(map[string]string)
		for k, v := range val.GetStructValue().GetFields() {
			c.Headers[k] = v.GetStringValue()
		}
	}

	if val, ok := fields["authTokenPlaceholder"]; ok {
		c.AuthTokenPlaceholder = val.GetStringValue()
	}

	return nil
}

// McpToolSelection defines how an agent selects tools from an MCP server.
type McpToolSelection struct {
	// Selection strategy ("all" or "specific").
	Strategy string `json:"strategy,omitempty"`
	// Specific tool names to allow (if strategy = specific).
	ToolNames []string `json:"toolNames,omitempty"`
}

// FromProto converts google.protobuf.Struct to McpToolSelection.
func (c *McpToolSelection) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["strategy"]; ok {
		c.Strategy = val.GetStringValue()
	}

	if val, ok := fields["toolNames"]; ok {
		// TODO: Implement FromProto for array field ToolNames
		_ = val // suppress unused variable warning
	}

	return nil
}

// VolumeMount defines a Docker volume mount.
type VolumeMount struct {
	// Host path or volume name.
	Source string `json:"source,omitempty"`
	// Container path.
	Target string `json:"target,omitempty"`
	// Mount is read-only.
	ReadOnly bool `json:"readOnly,omitempty"`
}

// FromProto converts google.protobuf.Struct to VolumeMount.
func (c *VolumeMount) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["source"]; ok {
		c.Source = val.GetStringValue()
	}

	if val, ok := fields["target"]; ok {
		c.Target = val.GetStringValue()
	}

	if val, ok := fields["readOnly"]; ok {
		c.ReadOnly = val.GetBoolValue()
	}

	return nil
}

// PortMapping defines a Docker port mapping.
type PortMapping struct {
	// Host port.
	HostPort int32 `json:"hostPort,omitempty"`
	// Container port.
	ContainerPort int32 `json:"containerPort,omitempty"`
	// Protocol (tcp or udp).
	Protocol string `json:"protocol,omitempty"`
}

// FromProto converts google.protobuf.Struct to PortMapping.
func (c *PortMapping) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["hostPort"]; ok {
		c.HostPort = int32(val.GetNumberValue())
	}

	if val, ok := fields["containerPort"]; ok {
		c.ContainerPort = int32(val.GetNumberValue())
	}

	if val, ok := fields["protocol"]; ok {
		c.Protocol = val.GetStringValue()
	}

	return nil
}

// EnvironmentSpec defines environment variables for an agent.
type EnvironmentSpec struct {
	// Environment variable definitions.
	Vars []*EnvironmentValue `json:"vars,omitempty"`
}

// FromProto converts google.protobuf.Struct to EnvironmentSpec.
func (c *EnvironmentSpec) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["vars"]; ok {
		// TODO: Implement FromProto for array field Vars
		_ = val // suppress unused variable warning
	}

	return nil
}

// EnvironmentValue defines a single environment variable.
type EnvironmentValue struct {
	// Variable name.
	Name string `json:"name,omitempty"`
	// Value or placeholder.
	Value string `json:"value,omitempty"`
	// Whether this value should be sourced from a secret.
	IsSecret bool `json:"isSecret,omitempty"`
}

// FromProto converts google.protobuf.Struct to EnvironmentValue.
func (c *EnvironmentValue) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["name"]; ok {
		c.Name = val.GetStringValue()
	}

	if val, ok := fields["value"]; ok {
		c.Value = val.GetStringValue()
	}

	if val, ok := fields["isSecret"]; ok {
		c.IsSecret = val.GetBoolValue()
	}

	return nil
}

// SubAgent represents a sub-agent that can be delegated to.
type SubAgent struct {
	// Inline sub-agent definition.
	// Note: InlineSubAgentSpec is defined in agent package to avoid circular imports
	InlineSpec interface{} `json:"inlineSpec,omitempty"`
	// Reference to existing Agent resource.
	AgentInstanceRefs *ApiResourceReference `json:"agentInstanceRefs,omitempty"`
}

// FromProto converts google.protobuf.Struct to SubAgent.
func (c *SubAgent) FromProto(s *structpb.Struct) error {
	fields := s.GetFields()

	if val, ok := fields["inlineSpec"]; ok {
		// TODO: Handle InlineSpec - requires agent package type
		_ = val // suppress unused variable warning
	}

	if val, ok := fields["agentInstanceRefs"]; ok {
		c.AgentInstanceRefs = &ApiResourceReference{}
		if err := c.AgentInstanceRefs.FromProto(val.GetStructValue()); err != nil {
			return err
		}
	}

	return nil
}
