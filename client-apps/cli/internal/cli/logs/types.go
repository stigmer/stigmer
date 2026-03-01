package logs

import (
	"time"
)

// LogLine represents a single log line with metadata
type LogLine struct {
	Timestamp time.Time
	Component string
	Line      string
	Original  string // Original line text
}

// ComponentConfig describes a log component
type ComponentConfig struct {
	Name         string
	LogFile      string
	ErrFile      string
	PreferStderr bool // If true, prefer stderr over stdout (for smart defaults)
}
