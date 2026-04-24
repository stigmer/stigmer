package daemon

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
)

// commandResult pairs a command response with a flag indicating whether the
// runner should stop after sending the response.
type commandResult struct {
	response      *runnerv1.RunnerCommandResponse
	stopRequested bool
}

// dispatchCommand routes a server-initiated command to the appropriate handler
// and returns the response. Every received command is logged to stdout per the
// security model: the user running the CLI must see what the server requests.
//
// The returned commandResult.stopRequested is true for the stop command,
// signaling the caller to initiate graceful shutdown after sending the ack.
func dispatchCommand(
	runnerID string,
	req *runnerv1.RunnerCommandRequest,
) commandResult {
	switch cmd := req.GetCommand().(type) {
	case *runnerv1.RunnerCommandRequest_ListDirectory:
		log.Info().
			Str("runner_id", runnerID).
			Str("request_id", req.GetRequestId()).
			Str("path", cmd.ListDirectory.GetPath()).
			Msg("Server requested directory listing")

		return commandResult{
			response: handleListDirectory(req.GetRequestId(), cmd.ListDirectory),
		}

	case *runnerv1.RunnerCommandRequest_Stop:
		log.Info().
			Str("runner_id", runnerID).
			Str("request_id", req.GetRequestId()).
			Str("reason", cmd.Stop.GetReason()).
			Msg("Server requested runner stop")

		return commandResult{
			response:      handleStop(req.GetRequestId()),
			stopRequested: true,
		}

	default:
		log.Warn().
			Str("runner_id", runnerID).
			Str("request_id", req.GetRequestId()).
			Msg("Received unknown command type, returning error")

		return commandResult{
			response: &runnerv1.RunnerCommandResponse{
				RequestId: req.GetRequestId(),
				Result: &runnerv1.RunnerCommandResponse_Error{
					Error: &runnerv1.RunnerCommandError{
						Message: "unknown command type",
					},
				},
			},
		}
	}
}

// handleStop acknowledges the server's stop request. The actual shutdown
// sequence (STOPPED heartbeat, stream close, process exit) is driven by the
// caller after the ack is sent.
func handleStop(requestID string) *runnerv1.RunnerCommandResponse {
	return &runnerv1.RunnerCommandResponse{
		RequestId: requestID,
		Result: &runnerv1.RunnerCommandResponse_Stop{
			Stop: &runnerv1.StopRunnerResponse{},
		},
	}
}

// handleListDirectory lists the contents of a directory on the runner's host.
//
// Path resolution:
//   - Empty or "~" -> user's home directory
//   - "~/..." -> expanded to $HOME/...
//   - Everything else -> used as-is (absolute or relative to cwd)
func handleListDirectory(
	requestID string,
	req *runnerv1.ListDirectoryRequest,
) *runnerv1.RunnerCommandResponse {
	homeDir, homeErr := os.UserHomeDir()
	cwd, cwdErr := os.Getwd()

	path := req.GetPath()
	resolvedPath, err := resolvePath(path, homeDir, homeErr)
	if err != nil {
		return commandError(requestID, err.Error())
	}

	absPath, err := filepath.Abs(resolvedPath)
	if err != nil {
		return commandError(requestID, "failed to resolve absolute path: "+err.Error())
	}

	dirEntries, err := os.ReadDir(absPath)
	if err != nil {
		return commandError(requestID, err.Error())
	}

	entries := make([]*runnerv1.DirectoryEntry, 0, len(dirEntries))
	for _, de := range dirEntries {
		entries = append(entries, &runnerv1.DirectoryEntry{
			Name:        de.Name(),
			IsDirectory: de.IsDir(),
			IsHidden:    strings.HasPrefix(de.Name(), "."),
		})
	}

	sort.Slice(entries, func(i, j int) bool {
		if entries[i].IsDirectory != entries[j].IsDirectory {
			return entries[i].IsDirectory
		}
		return entries[i].Name < entries[j].Name
	})

	resp := &runnerv1.ListDirectoryResponse{
		ResolvedPath: absPath,
		Entries:      entries,
	}
	if homeErr == nil {
		resp.HomeDirectory = homeDir
	}
	if cwdErr == nil {
		resp.CurrentDirectory = cwd
	}

	return &runnerv1.RunnerCommandResponse{
		RequestId: requestID,
		Result: &runnerv1.RunnerCommandResponse_ListDirectory{
			ListDirectory: resp,
		},
	}
}

// resolvePath expands ~ and handles empty paths.
func resolvePath(path, homeDir string, homeErr error) (string, error) {
	if path == "" || path == "~" {
		if homeErr != nil {
			return "", homeErr
		}
		return homeDir, nil
	}
	if strings.HasPrefix(path, "~/") {
		if homeErr != nil {
			return "", homeErr
		}
		return filepath.Join(homeDir, path[2:]), nil
	}
	return path, nil
}

// commandError builds a RunnerCommandResponse with an error result.
func commandError(requestID, message string) *runnerv1.RunnerCommandResponse {
	return &runnerv1.RunnerCommandResponse{
		RequestId: requestID,
		Result: &runnerv1.RunnerCommandResponse_Error{
			Error: &runnerv1.RunnerCommandError{
				Message: message,
			},
		},
	}
}
