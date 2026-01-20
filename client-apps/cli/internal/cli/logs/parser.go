package logs

import (
	"regexp"
	"time"
)

// Common timestamp patterns in logs
// Matches formats like:
// - 2026/01/20 23:12:00
// - 2026-01-20T23:12:00
// - 2026-01-20 23:12:00
var timestampPatterns = []*regexp.Regexp{
	regexp.MustCompile(`^(\d{4}[/-]\d{2}[/-]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)`),
	regexp.MustCompile(`^(\d{4}[/-]\d{2}[/-]\d{2}\s+\d{2}:\d{2}:\d{2})`),
}

var timestampFormats = []string{
	"2006/01/02 15:04:05",
	"2006-01-02T15:04:05",
	"2006-01-02 15:04:05",
	"2006/01/02 15:04:05.000",
	"2006-01-02T15:04:05.000",
	"2006-01-02 15:04:05.000",
	time.RFC3339,
	time.RFC3339Nano,
}

// ParseLogLine attempts to parse a log line and extract timestamp
func ParseLogLine(line, component string) LogLine {
	logLine := LogLine{
		Component: component,
		Line:      line,
		Original:  line,
		Timestamp: time.Now(), // Default to now if no timestamp found
	}

	// Try to extract timestamp from the line
	for _, pattern := range timestampPatterns {
		matches := pattern.FindStringSubmatch(line)
		if len(matches) > 1 {
			timestampStr := matches[1]
			
			// Try to parse with different formats
			for _, format := range timestampFormats {
				if t, err := time.Parse(format, timestampStr); err == nil {
					logLine.Timestamp = t
					return logLine
				}
			}
		}
	}

	return logLine
}

// FormatLogLine formats a log line with component prefix
func FormatLogLine(line LogLine) string {
	// Format: [component-name] original line
	return "[" + padRight(line.Component, 15) + "] " + line.Line
}

// padRight pads a string to the right with spaces
func padRight(s string, length int) string {
	if len(s) >= length {
		return s[:length]
	}
	padding := make([]byte, length-len(s))
	for i := range padding {
		padding[i] = ' '
	}
	return s + string(padding)
}
