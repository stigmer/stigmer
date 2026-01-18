package mcpserver

import "fmt"

// Option is a function that configures an MCP server.
type Option func(interface{}) error

// WithName sets the name of the MCP server.
// The name is used to reference the server in agent configuration.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithName("github"),
//		// ... other options
//	)
func WithName(name string) Option {
	return func(s interface{}) error {
		switch server := s.(type) {
		case *StdioServer:
			server.name = name
		case *HTTPServer:
			server.name = name
		case *DockerServer:
			server.name = name
		default:
			return fmt.Errorf("unsupported server type: %T", s)
		}
		return nil
	}
}

// WithEnabledTools specifies which tools from this MCP server should be enabled.
// If not specified or empty, all tools from the server are enabled.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithName("github"),
//		mcpserver.WithEnabledTools("create_issue", "list_repos", "create_pr"),
//	)
func WithEnabledTools(tools ...string) Option {
	return func(s interface{}) error {
		switch server := s.(type) {
		case *StdioServer:
			server.enabledTools = tools
		case *HTTPServer:
			server.enabledTools = tools
		case *DockerServer:
			server.enabledTools = tools
		default:
			return fmt.Errorf("unsupported server type: %T", s)
		}
		return nil
	}
}

// Stdio-specific options

// WithCommand sets the command to execute for a stdio server.
// Only applicable to StdioServer.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithCommand("npx"),
//		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//	)
func WithCommand(command string) Option {
	return func(s interface{}) error {
		server, ok := s.(*StdioServer)
		if !ok {
			return fmt.Errorf("WithCommand only applies to StdioServer, got %T", s)
		}
		server.command = command
		return nil
	}
}

// WithArgs sets the command arguments for stdio or docker servers.
// Only applicable to StdioServer and DockerServer.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithCommand("npx"),
//		mcpserver.WithArgs("-y", "@modelcontextprotocol/server-github"),
//	)
func WithArgs(args ...string) Option {
	return func(s interface{}) error {
		switch server := s.(type) {
		case *StdioServer:
			server.args = args
		case *DockerServer:
			server.args = args
		default:
			return fmt.Errorf("WithArgs only applies to StdioServer or DockerServer, got %T", s)
		}
		return nil
	}
}

// WithEnvPlaceholder adds an environment variable placeholder for stdio or docker servers.
// The placeholder value (e.g., "${GITHUB_TOKEN}") will be resolved at agent instance runtime.
// Only applicable to StdioServer and DockerServer.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithEnvPlaceholder("GITHUB_TOKEN", "${GITHUB_TOKEN}"),
//		mcpserver.WithEnvPlaceholder("GITHUB_ORG", "${GITHUB_ORG}"),
//	)
func WithEnvPlaceholder(key, value string) Option {
	return func(s interface{}) error {
		switch server := s.(type) {
		case *StdioServer:
			server.envPlaceholders[key] = value
		case *DockerServer:
			server.envPlaceholders[key] = value
		default:
			return fmt.Errorf("WithEnvPlaceholder only applies to StdioServer or DockerServer, got %T", s)
		}
		return nil
	}
}

// WithWorkingDir sets the working directory for a stdio server process.
// Only applicable to StdioServer.
//
// Example:
//
//	mcpserver.Stdio(
//		mcpserver.WithCommand("python"),
//		mcpserver.WithWorkingDir("/app/mcp-servers"),
//	)
func WithWorkingDir(dir string) Option {
	return func(s interface{}) error {
		server, ok := s.(*StdioServer)
		if !ok {
			return fmt.Errorf("WithWorkingDir only applies to StdioServer, got %T", s)
		}
		server.workingDir = dir
		return nil
	}
}

// HTTP-specific options

// WithURL sets the base URL for an HTTP server.
// Only applicable to HTTPServer.
//
// Example:
//
//	mcpserver.HTTP(
//		mcpserver.WithURL("https://mcp.example.com"),
//	)
func WithURL(url string) Option {
	return func(s interface{}) error {
		server, ok := s.(*HTTPServer)
		if !ok {
			return fmt.Errorf("WithURL only applies to HTTPServer, got %T", s)
		}
		server.url = url
		return nil
	}
}

// WithHeader adds an HTTP header for an HTTP server.
// Headers can contain placeholders (e.g., "${API_TOKEN}") that are resolved at runtime.
// Only applicable to HTTPServer.
//
// Example:
//
//	mcpserver.HTTP(
//		mcpserver.WithHeader("Authorization", "Bearer ${API_TOKEN}"),
//		mcpserver.WithHeader("X-Custom-Header", "value"),
//	)
func WithHeader(key, value string) Option {
	return func(s interface{}) error {
		server, ok := s.(*HTTPServer)
		if !ok {
			return fmt.Errorf("WithHeader only applies to HTTPServer, got %T", s)
		}
		server.headers[key] = value
		return nil
	}
}

// WithQueryParam adds a query parameter for an HTTP server.
// Query parameters can contain placeholders (e.g., "${AWS_REGION}") resolved at runtime.
// Only applicable to HTTPServer.
//
// Example:
//
//	mcpserver.HTTP(
//		mcpserver.WithQueryParam("region", "${AWS_REGION}"),
//		mcpserver.WithQueryParam("version", "v1"),
//	)
func WithQueryParam(key, value string) Option {
	return func(s interface{}) error {
		server, ok := s.(*HTTPServer)
		if !ok {
			return fmt.Errorf("WithQueryParam only applies to HTTPServer, got %T", s)
		}
		server.queryParams[key] = value
		return nil
	}
}

// WithTimeout sets the HTTP timeout in seconds for an HTTP server.
// Only applicable to HTTPServer. Default is 30 seconds.
//
// Example:
//
//	mcpserver.HTTP(
//		mcpserver.WithURL("https://mcp.example.com"),
//		mcpserver.WithTimeout(60),
//	)
func WithTimeout(seconds int32) Option {
	return func(s interface{}) error {
		server, ok := s.(*HTTPServer)
		if !ok {
			return fmt.Errorf("WithTimeout only applies to HTTPServer, got %T", s)
		}
		server.timeoutSeconds = seconds
		return nil
	}
}

// Docker-specific options

// WithImage sets the Docker image for a docker server.
// Only applicable to DockerServer.
//
// Example:
//
//	mcpserver.Docker(
//		mcpserver.WithImage("ghcr.io/org/mcp:latest"),
//	)
func WithImage(image string) Option {
	return func(s interface{}) error {
		server, ok := s.(*DockerServer)
		if !ok {
			return fmt.Errorf("WithImage only applies to DockerServer, got %T", s)
		}
		server.image = image
		return nil
	}
}

// WithVolumeMount adds a volume mount for a docker server.
// Only applicable to DockerServer.
//
// Example:
//
//	mcpserver.Docker(
//		mcpserver.WithVolumeMount("/host/data", "/container/data", false),
//		mcpserver.WithVolumeMount("/host/config", "/etc/config", true), // read-only
//	)
func WithVolumeMount(hostPath, containerPath string, readOnly bool) Option {
	return func(s interface{}) error {
		server, ok := s.(*DockerServer)
		if !ok {
			return fmt.Errorf("WithVolumeMount only applies to DockerServer, got %T", s)
		}
		server.volumes = append(server.volumes, VolumeMount{
			HostPath:      hostPath,
			ContainerPath: containerPath,
			ReadOnly:      readOnly,
		})
		return nil
	}
}

// WithPortMapping adds a port mapping for a docker server.
// Protocol can be "tcp" or "udp" (defaults to "tcp" if empty).
// Only applicable to DockerServer.
//
// Example:
//
//	mcpserver.Docker(
//		mcpserver.WithPortMapping(8080, 80, "tcp"),
//		mcpserver.WithPortMapping(5353, 53, "udp"),
//	)
func WithPortMapping(hostPort, containerPort int32, protocol string) Option {
	return func(s interface{}) error {
		server, ok := s.(*DockerServer)
		if !ok {
			return fmt.Errorf("WithPortMapping only applies to DockerServer, got %T", s)
		}
		server.ports = append(server.ports, PortMapping{
			HostPort:      hostPort,
			ContainerPort: containerPort,
			Protocol:      protocol,
		})
		return nil
	}
}

// WithNetwork sets the Docker network for a docker server.
// Only applicable to DockerServer.
//
// Example:
//
//	mcpserver.Docker(
//		mcpserver.WithNetwork("mcp-network"),
//	)
func WithNetwork(network string) Option {
	return func(s interface{}) error {
		server, ok := s.(*DockerServer)
		if !ok {
			return fmt.Errorf("WithNetwork only applies to DockerServer, got %T", s)
		}
		server.network = network
		return nil
	}
}

// WithContainerName sets the container name for a docker server.
// Only applicable to DockerServer.
//
// Example:
//
//	mcpserver.Docker(
//		mcpserver.WithContainerName("my-mcp-server"),
//	)
func WithContainerName(name string) Option {
	return func(s interface{}) error {
		server, ok := s.(*DockerServer)
		if !ok {
			return fmt.Errorf("WithContainerName only applies to DockerServer, got %T", s)
		}
		server.containerName = name
		return nil
	}
}
