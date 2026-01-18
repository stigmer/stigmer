package mcpserver

// MCPServer represents an MCP server that can be attached to an agent.
// MCP servers provide tools and capabilities to agents at runtime.
type MCPServer interface {
	// Name returns the server name (e.g., "github", "aws", "slack").
	Name() string

	// EnabledTools returns the list of tool names to enable from this server.
	// Empty slice means all tools are enabled.
	EnabledTools() []string

	// Type returns the server type (stdio, http, or docker).
	Type() ServerType

	// Validate checks if the server configuration is valid.
	Validate() error
}

// ServerType represents the type of MCP server.
type ServerType int

const (
	// TypeStdio is a subprocess-based server with stdin/stdout communication.
	TypeStdio ServerType = iota

	// TypeHTTP is an HTTP + SSE based server.
	TypeHTTP

	// TypeDocker is a containerized server.
	TypeDocker
)

// String returns the string representation of the server type.
func (st ServerType) String() string {
	switch st {
	case TypeStdio:
		return "stdio"
	case TypeHTTP:
		return "http"
	case TypeDocker:
		return "docker"
	default:
		return "unknown"
	}
}

// VolumeMount represents a Docker volume mount configuration.
type VolumeMount struct {
	HostPath      string // Host path to mount
	ContainerPath string // Container path where the volume is mounted
	ReadOnly      bool   // Whether the mount is read-only
}

// PortMapping represents a Docker port mapping configuration.
type PortMapping struct {
	HostPort      int32  // Host port to bind to
	ContainerPort int32  // Container port to expose
	Protocol      string // Protocol (tcp or udp)
}

// baseServer contains common fields for all MCP server types.
type baseServer struct {
	name         string
	enabledTools []string
}

func (b *baseServer) Name() string {
	return b.name
}

func (b *baseServer) EnabledTools() []string {
	return b.enabledTools
}
