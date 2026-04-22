package daemon

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
)

// dispatchCommand routes a server-initiated command to the appropriate handler
// and returns the response. Every received command is logged to stdout per the
// security model: the user running the CLI must see what the server requests.
func dispatchCommand(
	runnerID string,
	req *runnerv1.RunnerCommandRequest,
) *runnerv1.RunnerCommandResponse {
	switch cmd := req.GetCommand().(type) {
	case *runnerv1.RunnerCommandRequest_ListDirectory:
		log.Info().
			Str("runner_id", runnerID).
			Str("request_id", req.GetRequestId()).
			Str("path", cmd.ListDirectory.GetPath()).
			Msg("Server requested directory listing")

		return handleListDirectory(req.GetRequestId(), cmd.ListDirectory)

	default:
		log.Warn().
			Str("runner_id", runnerID).
			Str("request_id", req.GetRequestId()).
			Msg("Received unknown command type, returning error")

		return &runnerv1.RunnerCommandResponse{
			RequestId: req.GetRequestId(),
			Result: &runnerv1.RunnerCommandResponse_Error{
				Error: &runnerv1.RunnerCommandError{
					Message: "unknown command type",
				},
			},
		}
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
