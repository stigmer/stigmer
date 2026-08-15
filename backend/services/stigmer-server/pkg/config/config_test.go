package config

import (
	"strings"
	"testing"
)

// TestLoadOperatorIdentity pins the operator-identity config contract
// (stigmer/stigmer#400): unset stays unset (the anonymous-on-self-hosted
// default), values are trimmed, and the two misconfigurations fail loudly —
// audit actors feed MCP caller-identity bindings, so silently stamping a
// typo'd email would mint a wrong grantable value.
func TestLoadOperatorIdentity(t *testing.T) {
	cases := []struct {
		desc      string
		email     string
		name      string
		wantEmail string
		wantName  string
		wantErr   string
	}{
		{
			desc: "unset stays unset",
		},
		{
			desc:      "configured identity is returned",
			email:     "ada@example.com",
			name:      "Ada Lovelace",
			wantEmail: "ada@example.com",
			wantName:  "Ada Lovelace",
		},
		{
			desc:      "email alone is enough — display name is optional",
			email:     "ada@example.com",
			wantEmail: "ada@example.com",
		},
		{
			desc:      "surrounding whitespace is trimmed",
			email:     "  ada@example.com  ",
			name:      "  Ada  ",
			wantEmail: "ada@example.com",
			wantName:  "Ada",
		},
		{
			desc:    "email without an @ fails the boot",
			email:   "ada.example.com",
			wantErr: "not an email address",
		},
		{
			desc:    "name without an email fails the boot",
			name:    "Ada Lovelace",
			wantErr: "the email is the identity",
		},
	}

	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			t.Setenv("STIGMER_OPERATOR_EMAIL", c.email)
			t.Setenv("STIGMER_OPERATOR_NAME", c.name)

			email, name, err := loadOperatorIdentity()
			if c.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), c.wantErr) {
					t.Fatalf("want error containing %q, got %v", c.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if email != c.wantEmail || name != c.wantName {
				t.Errorf("got (%q, %q), want (%q, %q)", email, name, c.wantEmail, c.wantName)
			}
		})
	}
}
