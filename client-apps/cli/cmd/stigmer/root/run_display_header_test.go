package root

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFormatMetadataSection_ModeRow(t *testing.T) {
	tests := []struct {
		name     string
		mode     string
		contains string
		absent   string
	}{
		{
			name:   "empty mode omits row",
			mode:   "",
			absent: "Mode:",
		},
		{
			name:   "agent mode omits row",
			mode:   "agent",
			absent: "Mode:",
		},
		{
			name:     "plan mode renders row",
			mode:     "plan",
			contains: "Plan (read-only)",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info := sessionHeaderInfo{
				SessionID: "ses-test",
				Mode:      tt.mode,
			}
			result := formatMetadataSection(info)

			if tt.contains != "" {
				assert.True(t, strings.Contains(result, tt.contains),
					"expected metadata to contain %q, got:\n%s", tt.contains, result)
			}
			if tt.absent != "" {
				assert.False(t, strings.Contains(result, tt.absent),
					"expected metadata to NOT contain %q, got:\n%s", tt.absent, result)
			}
		})
	}
}
