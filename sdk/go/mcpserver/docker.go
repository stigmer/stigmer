package mcpserver

import (
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// DockerArgs is an alias for the generated DockerServer type from codegen.
// This follows the pattern of using generated types for Args structs.
type DockerArgs = types.DockerServer

// DockerServer represents a Docker-based MCP server that runs in a container.
//
// Example:
//
//	server, _ := mcpserver.Docker(ctx, "custom-mcp", &mcpserver.DockerArgs{
//	    Image: "ghcr.io/org/mcp:latest",
//	    EnvPlaceholders: map[string]string{
//	        "API_KEY": "${API_KEY}",
//	    },
//	    Volumes: []*types.VolumeMount{
//	        {HostPath: "/data", ContainerPath: "/mnt/data", ReadOnly: true},
//	    },
//	})
type DockerServer struct {
	baseServer
	image           string
	args            []string
	envPlaceholders map[string]string
	volumes         []*types.VolumeMount
	network         string
	ports           []*types.PortMapping
	containerName   string
}

// Docker creates a new Docker-based MCP server with struct-based args (Pulumi pattern).
//
// The args struct uses the generated types.DockerServer from proto definitions.
// This ensures the Args always match the proto schema.
//
// Follows Pulumi's Args pattern: context, name as parameters, struct args for configuration.
//
// Required:
//   - ctx: stigmer context (for consistency with other resources)
//   - name: server name (e.g., "custom-mcp")
//   - args.Image: Docker image name
//
// Optional args fields (from generated types.DockerServer):
//   - Args: container command arguments
//   - EnvPlaceholders: environment variable placeholders
//   - Volumes: volume mount configurations (use []*types.VolumeMount)
//   - Network: Docker network name
//   - Ports: port mapping configurations (use []*types.PortMapping)
//   - ContainerName: container name
//
// Note: EnabledTools is set separately via the EnableTools() builder method,
// as it's defined on McpServerDefinition in proto, not on DockerServer.
//
// Example:
//
//	custom, err := mcpserver.Docker(ctx, "custom-mcp", &mcpserver.DockerArgs{
//	    Image: "ghcr.io/org/mcp:latest",
//	    Args:  []string{"--config", "/etc/mcp.yaml"},
//	    EnvPlaceholders: map[string]string{
//	        "API_KEY": "${API_KEY}",
//	    },
//	    Volumes: []*types.VolumeMount{
//	        {HostPath: "/host/data", ContainerPath: "/container/data", ReadOnly: false},
//	    },
//	    Ports: []*types.PortMapping{
//	        {HostPort: 8080, ContainerPort: 80, Protocol: "tcp"},
//	    },
//	    Network:       "mcp-network",
//	    ContainerName: "my-mcp-server",
//	})
//	custom.EnableTools("tool1", "tool2")  // Set enabled tools
func Docker(ctx Context, name string, args *DockerArgs) (*DockerServer, error) {
	// Nil-safety: if args is nil, create empty args
	if args == nil {
		args = &DockerArgs{}
	}

	// Initialize collections
	envPlaceholders := args.EnvPlaceholders
	if envPlaceholders == nil {
		envPlaceholders = make(map[string]string)
	}

	server := &DockerServer{
		baseServer: baseServer{
			name: name,
		},
		image:           args.Image,
		args:            args.Args,
		envPlaceholders: envPlaceholders,
		volumes:         args.Volumes,
		network:         args.Network,
		ports:           args.Ports,
		containerName:   args.ContainerName,
	}

	return server, nil
}

// EnableTools sets the enabled tools for this server (builder pattern).
// If not called or called with empty slice, all tools are enabled.
func (d *DockerServer) EnableTools(tools ...string) *DockerServer {
	d.enabledTools = tools
	return d
}

// Image returns the Docker image name.
func (d *DockerServer) Image() string {
	return d.image
}

// Args returns the container command arguments.
func (d *DockerServer) Args() []string {
	return d.args
}

// EnvPlaceholders returns the environment variable placeholders.
func (d *DockerServer) EnvPlaceholders() map[string]string {
	return d.envPlaceholders
}

// Volumes returns the volume mounts.
func (d *DockerServer) Volumes() []*types.VolumeMount {
	return d.volumes
}

// Network returns the Docker network name.
func (d *DockerServer) Network() string {
	return d.network
}

// Ports returns the port mappings.
func (d *DockerServer) Ports() []*types.PortMapping {
	return d.ports
}

// ContainerName returns the container name.
func (d *DockerServer) ContainerName() string {
	return d.containerName
}

// Type returns the server type (docker).
func (d *DockerServer) Type() ServerType {
	return TypeDocker
}
