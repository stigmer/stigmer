package runner

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/pkg/errors"
)

const (
	defaultDockerImage    = "ghcr.io/stigmer/agent-runner"
	containerNamePrefix   = "stigmer-runner-"
	dockerStopGracePeriod = 10
)

// ContainerRunOpts holds the parameters for starting an agent-runner container.
type ContainerRunOpts struct {
	Name  string
	Image string
	Env   map[string]string
}

// ContainerState holds the result of inspecting a running container.
type ContainerState struct {
	Running  bool
	ExitCode int
}

// DockerClient abstracts Docker CLI operations so callers are decoupled from
// the exec.Command implementation. This enables testing with a mock and a
// future swap to the Docker SDK if ever needed.
type DockerClient interface {
	IsAvailable(ctx context.Context) error
	Run(ctx context.Context, opts ContainerRunOpts) (containerID string, err error)
	Inspect(ctx context.Context, containerID string) (ContainerState, error)
	Stop(ctx context.Context, containerID string) error
	Remove(ctx context.Context, containerID string) error
	Wait(ctx context.Context, containerID string) (exitCode int, err error)
	Logs(ctx context.Context, containerID string) error
}

// NewDockerClient returns a DockerClient that shells out to the docker binary.
func NewDockerClient() DockerClient {
	return &execDockerClient{}
}

type execDockerClient struct{}

func (c *execDockerClient) IsAvailable(ctx context.Context) error {
	out, err := runDockerCmd(ctx, "version", "--format", "{{.Server.Version}}")
	if err != nil {
		return errors.New(
			"Docker is not available\n\n" +
				"The --runtime docker flag requires a running Docker daemon.\n" +
				"Install Docker: https://docs.docker.com/get-docker/\n\n" +
				"If Docker is installed, ensure the daemon is running:\n" +
				"  docker info",
		)
	}
	if strings.TrimSpace(out) == "" {
		return errors.New("Docker daemon is not responding (empty version)")
	}
	return nil
}

func (c *execDockerClient) Run(ctx context.Context, opts ContainerRunOpts) (string, error) {
	args := []string{
		"run", "-d",
		"--name", containerNamePrefix + opts.Name,
	}

	for k, v := range opts.Env {
		args = append(args, "-e", fmt.Sprintf("%s=%s", k, v))
	}

	args = append(args, opts.Image)

	out, err := runDockerCmd(ctx, args...)
	if err != nil {
		return "", errors.Wrap(err, "docker run failed")
	}

	containerID := strings.TrimSpace(out)
	if containerID == "" {
		return "", errors.New("docker run returned empty container ID")
	}
	return containerID, nil
}

func (c *execDockerClient) Inspect(ctx context.Context, containerID string) (ContainerState, error) {
	out, err := runDockerCmd(ctx, "inspect",
		"--format", "{{.State.Running}} {{.State.ExitCode}}",
		containerID,
	)
	if err != nil {
		return ContainerState{}, errors.Wrapf(err, "docker inspect failed for container %s", containerID)
	}

	var running string
	var exitCode int
	if _, parseErr := fmt.Sscanf(strings.TrimSpace(out), "%s %d", &running, &exitCode); parseErr != nil {
		return ContainerState{}, errors.Wrapf(parseErr,
			"failed to parse docker inspect output: %q", strings.TrimSpace(out))
	}

	return ContainerState{
		Running:  running == "true",
		ExitCode: exitCode,
	}, nil
}

func (c *execDockerClient) Stop(ctx context.Context, containerID string) error {
	_, err := runDockerCmd(ctx, "stop",
		"-t", fmt.Sprintf("%d", dockerStopGracePeriod),
		containerID,
	)
	if err != nil {
		return errors.Wrapf(err, "docker stop failed for container %s", containerID)
	}
	return nil
}

func (c *execDockerClient) Remove(ctx context.Context, containerID string) error {
	_, err := runDockerCmd(ctx, "rm", "-f", containerID)
	if err != nil {
		return errors.Wrapf(err, "docker rm failed for container %s", containerID)
	}
	return nil
}

func (c *execDockerClient) Wait(ctx context.Context, containerID string) (int, error) {
	out, err := runDockerCmd(ctx, "wait", containerID)
	if err != nil {
		return -1, errors.Wrapf(err, "docker wait failed for container %s", containerID)
	}

	var exitCode int
	if _, parseErr := fmt.Sscanf(strings.TrimSpace(out), "%d", &exitCode); parseErr != nil {
		return -1, errors.Wrapf(parseErr,
			"failed to parse docker wait output: %q", strings.TrimSpace(out))
	}
	return exitCode, nil
}

func (c *execDockerClient) Logs(ctx context.Context, containerID string) error {
	cmd := exec.CommandContext(ctx, "docker", "logs", "-f", containerID)
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Run()
}

// WaitUntilRunning polls the container state until it reports Running=true.
// Returns an error if the container exits or the timeout is exceeded.
func WaitUntilRunning(ctx context.Context, dc DockerClient, containerID string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if time.Now().After(deadline) {
				return errors.Errorf("container %s did not reach running state within %s", containerID, timeout)
			}

			state, err := dc.Inspect(ctx, containerID)
			if err != nil {
				return errors.Wrap(err, "failed to inspect container while waiting for startup")
			}

			if state.Running {
				return nil
			}

			if state.ExitCode != 0 {
				return errors.Errorf("container %s exited with code %d before reaching running state",
					containerID, state.ExitCode)
			}
		}
	}
}

// IsContainerAlive checks whether a container exists and is running.
// Returns false (without error) if the container does not exist or is stopped.
func IsContainerAlive(dc DockerClient, containerID string) bool {
	if containerID == "" {
		return false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	state, err := dc.Inspect(ctx, containerID)
	if err != nil {
		return false
	}
	return state.Running
}

// DefaultImage returns the fully qualified agent-runner image reference for
// the given CLI version. If version is empty or "dev", it defaults to "latest".
func DefaultImage(cliVersion string) string {
	tag := cliVersion
	if tag == "" || tag == "dev" {
		tag = "latest"
	}
	return fmt.Sprintf("%s:%s", defaultDockerImage, tag)
}

// runDockerCmd executes a docker command and returns its combined stdout.
// Stderr is captured and included in the error message on failure.
func runDockerCmd(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := strings.TrimSpace(stderr.String())
		if errMsg != "" {
			return "", errors.Wrapf(err, "%s", errMsg)
		}
		return "", err
	}
	return stdout.String(), nil
}
