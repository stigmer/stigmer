package approval

import (
	"fmt"
	"strings"
)

// ParseAction converts a CLI flag string to an Action value.
//
// Accepted values (case-insensitive): "approve", "skip", "reject".
// Returns an error for empty or unrecognized values.
func ParseAction(s string) (Action, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "approve":
		return ActionApprove, nil
	case "skip":
		return ActionSkip, nil
	case "reject":
		return ActionReject, nil
	default:
		return ActionUnspecified, fmt.Errorf("invalid approval action %q: must be one of: approve, skip, reject", s)
	}
}
