package controlsock

import "time"

// StatusResponse is the JSON payload returned by GET /status on the
// runner's local control socket. It provides verified, live state that
// is fresher and more trustworthy than the on-disk state file because
// only a running Stigmer runner process can serve it.
type StatusResponse struct {
	OK              bool      `json:"ok"`
	RunnerID        string    `json:"runner_id"`
	Name            string    `json:"name"`
	MachineID       string    `json:"machine_id,omitempty"`
	Org             string    `json:"org"`
	BackendEndpoint string    `json:"backend_endpoint"`
	TaskQueue       string    `json:"task_queue"`
	PID             int       `json:"pid"`
	StartedAt       time.Time `json:"started_at"`
	Uptime          string    `json:"uptime"`
	Runtime         string    `json:"runtime"`
	Version         string    `json:"version,omitempty"`
}

// StopResponse is the JSON payload returned by POST /stop on the
// runner's local control socket.
type StopResponse struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
}

// ErrorResponse is the JSON payload returned for error conditions.
type ErrorResponse struct {
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}
