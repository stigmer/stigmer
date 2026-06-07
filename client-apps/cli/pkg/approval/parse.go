package approval

import (
	"fmt"
	"strings"
)

// ParseAction converts a CLI flag string to an Action value.
//
// Accepted values (case-insensitive): "approve", "skip", "reject",
// "approve-all" (aliases: "approve_all", "approveall").
// Returns an error for empty or unrecognized values.
func ParseAction(s string) (Action, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "approve":
		return ActionApprove, nil
	case "skip":
		return ActionSkip, nil
	case "reject":
		return ActionReject, nil
	case "approve-all", "approve_all", "approveall":
		return ActionApproveAll, nil
	default:
		return ActionUnspecified, fmt.Errorf("invalid approval action %q: must be one of: approve, skip, reject, approve-all", s)
	}
}
