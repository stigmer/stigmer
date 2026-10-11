package duration

import "testing"

func TestParseMinutes(t *testing.T) {
	tests := []struct {
		in      string
		want    int
		wantErr bool
	}{
		{in: "1h30m", want: 90},
		{in: "45m", want: 45},
		{in: "2h", want: 120},
		{in: "", wantErr: true},
		{in: "abc", wantErr: true},
		{in: "10", wantErr: true},
	}
	for _, tt := range tests {
		got, err := ParseMinutes(tt.in)
		if tt.wantErr {
			if err == nil {
				t.Errorf("ParseMinutes(%q) = %d, want an error", tt.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("ParseMinutes(%q) returned error %v", tt.in, err)
			continue
		}
		if got != tt.want {
			t.Errorf("ParseMinutes(%q) = %d, want %d", tt.in, got, tt.want)
		}
	}
}
