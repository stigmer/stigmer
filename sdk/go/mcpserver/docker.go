package mcpserver

import (
	"fmt"
)

// DockerServer represents a Docker-based MCP server that runs in a container.
//
// Example:
//
//	server := mcpserver.Docker(
//		mcpserver.WithName("custom-mcp"),
//		mcpserver.WithImage("ghcr.io/org/mcp:latest"),
//		mcpserver.WithEnvPlaceholder("API_KEY", "${API_KEY}"),
//		mcpserver.WithVolumeMount("/data", "/mnt/data", true),
//		mcpserver.WithPortMapping(8080, 80, "tcp"),
//	)
type DockerServer struct {
	baseServer
	image           string
	args            []string
	envPlaceholders map[string]string
	volumes         []VolumeMount
	network         string
	ports           []PortMapping
	containerName   string
}

// Docker creates a new Docker-based MCP server with the given options.
//
// Example:
//
//	custom := mcpserver.Docker(
//		mcpserver.WithName("custom-mcp"),
//		mcpserver.WithImage("ghcr.io/org/mcp:latest"),
//		mcpserver.WithArgs("--config", "/etc/mcp.yaml"),
//		mcpserver.WithEnvPlaceholder("API_KEY", "${API_KEY}"),
//		mcpserver.WithVolumeMount("/host/data", "/container/data", false),
//		mcpserver.WithPortMapping(8080, 80, "tcp"),
//		mcpserver.WithNetwork("mcp-network"),
//		mcpserver.WithContainerName("my-mcp-server"),
//		mcpserver.WithEnabledTools("tool1", "tool2"),
//	)
func Docker(opts ...Option) (*DockerServer, error) {
	server := &DockerServer{
		envPlaceholders: make(map[string]string),
		volumes:         []VolumeMount{},
		ports:           []PortMapping{},
	}

	for _, opt := range opts {
		if err := opt(server); err != nil {
			return nil, fmt.Errorf("docker server option: %w", err)
		}
	}

	if err := server.Validate(); err != nil {
		return nil, err
	}

	return server, nil
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
func (d *DockerServer) Volumes() []VolumeMount {
	return d.volumes
}

// Network returns the Docker network name.
func (d *DockerServer) Network() string {
	return d.network
}

// Ports returns the port mappings.
func (d *DockerServer) Ports() []PortMapping {
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

// Validate checks if the Docker server configuration is valid.
func (d *DockerServer) Validate() error {
	if d.name == "" {
		return fmt.Errorf("docker server: name is required")
	}
	if d.image == "" {
		return fmt.Errorf("docker server %q: image is required", d.name)
	}

	// Validate volume mounts
	for i, vol := range d.volumes {
		if vol.HostPath == "" {
			return fmt.Errorf("docker server %q: volume[%d]: host_path is required", d.name, i)
		}
		if vol.ContainerPath == "" {
			return fmt.Errorf("docker server %q: volume[%d]: container_path is required", d.name, i)
		}
	}

	// Validate port mappings
	for i, port := range d.ports {
		if port.HostPort <= 0 {
			return fmt.Errorf("docker server %q: port[%d]: host_port must be > 0", d.name, i)
		}
		if port.ContainerPort <= 0 {
			return fmt.Errorf("docker server %q: port[%d]: container_port must be > 0", d.name, i)
		}
		if port.Protocol != "" && port.Protocol != "tcp" && port.Protocol != "udp" {
			return fmt.Errorf("docker server %q: port[%d]: protocol must be tcp or udp", d.name, i)
		}
	}

	return nil
}
