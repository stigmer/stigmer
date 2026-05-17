package root

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateMode(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errMsg  string
	}{
		{name: "empty string is valid (default)", input: "", wantErr: false},
		{name: "agent is valid", input: "agent", wantErr: false},
		{name: "plan is valid", input: "plan", wantErr: false},
		{name: "invalid value rejected", input: "ask", wantErr: true, errMsg: `invalid --mode value "ask"`},
		{name: "uppercase rejected", input: "Plan", wantErr: true, errMsg: `invalid --mode value "Plan"`},
		{name: "arbitrary string rejected", input: "debug", wantErr: true, errMsg: `invalid --mode value "debug"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateMode(tt.input)
			if tt.wantErr {
				require.Error(t, err)
				assert.Contains(t, err.Error(), tt.errMsg)
			} else {
				require.NoError(t, err)
			}
		})
	}
}
