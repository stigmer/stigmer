package ignore

import "fmt"

// Reason explains why a path was or wasn't ignored.
type Reason int

const (
	// ReasonNoMatch indicates no pattern matched; the file is included by default.
	ReasonNoMatch Reason = iota

	// ReasonExcluded indicates the path matched an exclusion pattern.
	ReasonExcluded

	// ReasonIncluded indicates the path matched a negation pattern (!pattern),
	// explicitly including a file that would otherwise be excluded.
	ReasonIncluded

	// ReasonDefaultDeny indicates the path was excluded by a built-in default
	// security pattern (e.g., .env, *.pem).
	ReasonDefaultDeny
)

// String returns a human-readable description of the reason.
func (r Reason) String() string {
	switch r {
	case ReasonNoMatch:
		return "no pattern matched"
	case ReasonExcluded:
		return "excluded by pattern"
	case ReasonIncluded:
		return "included by negation pattern"
	case ReasonDefaultDeny:
		return "excluded by security default"
	default:
		return fmt.Sprintf("unknown reason (%d)", int(r))
	}
}

// MatchResult provides detailed information about why a path was matched.
// This is useful for debugging, dry-run mode, and understanding ignore behavior.
type MatchResult struct {
	// Path is the path that was evaluated.
	Path string

	// IsDir indicates whether the path is a directory.
	IsDir bool

	// Ignored is true if the path should be excluded from the artifact.
	Ignored bool

	// Reason explains why the match decision was made.
	Reason Reason

	// Source identifies which pattern source defined the matching pattern.
	// Examples: "defaults", ".gitignore", ".stigmerignore", "cli"
	// Empty if no pattern matched.
	Source string

	// Pattern is the pattern that matched.
	// Empty if no pattern matched.
	Pattern string
}

// String returns a human-readable description of the match result.
func (r MatchResult) String() string {
	if !r.Ignored {
		if r.Reason == ReasonIncluded {
			return fmt.Sprintf("INCLUDE %s (%s from %s: %s)", r.Path, r.Reason, r.Source, r.Pattern)
		}
		return fmt.Sprintf("INCLUDE %s (%s)", r.Path, r.Reason)
	}

	if r.Pattern != "" {
		return fmt.Sprintf("IGNORE  %s (%s from %s: %s)", r.Path, r.Reason, r.Source, r.Pattern)
	}
	return fmt.Sprintf("IGNORE  %s (%s)", r.Path, r.Reason)
}
