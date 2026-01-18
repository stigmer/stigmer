package skill

import (
	"testing"
)

func TestPlatform(t *testing.T) {
	tests := []struct {
		name         string
		slug         string
		expectedSlug string
	}{
		{
			name:         "platform skill",
			slug:         "coding-best-practices",
			expectedSlug: "coding-best-practices",
		},
		{
			name:         "platform skill with hyphens",
			slug:         "security-analysis-v2",
			expectedSlug: "security-analysis-v2",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill := Platform(tt.slug)

			if skill.Slug != tt.expectedSlug {
				t.Errorf("Platform() Slug = %v, want %v", skill.Slug, tt.expectedSlug)
			}
			if skill.Org != "" {
				t.Errorf("Platform() Org = %v, want empty string", skill.Org)
			}
			if !skill.IsPlatformReference() {
				t.Error("Platform() IsPlatformReference() = false, want true")
			}
			if skill.IsOrganizationReference() {
				t.Error("Platform() IsOrganizationReference() = true, want false")
			}
		})
	}
}

func TestOrganization(t *testing.T) {
	tests := []struct {
		name         string
		org          string
		slug         string
		expectedOrg  string
		expectedSlug string
	}{
		{
			name:         "org skill",
			org:          "my-org",
			slug:         "internal-docs",
			expectedOrg:  "my-org",
			expectedSlug: "internal-docs",
		},
		{
			name:         "org skill with complex names",
			org:          "security-team",
			slug:         "vulnerability-analysis",
			expectedOrg:  "security-team",
			expectedSlug: "vulnerability-analysis",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			skill := Organization(tt.org, tt.slug)

			if skill.Slug != tt.expectedSlug {
				t.Errorf("Organization() Slug = %v, want %v", skill.Slug, tt.expectedSlug)
			}
			if skill.Org != tt.expectedOrg {
				t.Errorf("Organization() Org = %v, want %v", skill.Org, tt.expectedOrg)
			}
			if skill.IsPlatformReference() {
				t.Error("Organization() IsPlatformReference() = true, want false")
			}
			if !skill.IsOrganizationReference() {
				t.Error("Organization() IsOrganizationReference() = false, want true")
			}
		})
	}
}

func TestSkill_IsPlatformReference(t *testing.T) {
	tests := []struct {
		name     string
		skill    Skill
		expected bool
	}{
		{
			name:     "platform skill",
			skill:    Platform("coding-best-practices"),
			expected: true,
		},
		{
			name:     "organization skill",
			skill:    Organization("my-org", "internal-docs"),
			expected: false,
		},
		{
			name:     "skill with empty org",
			skill:    Skill{Slug: "test", Org: ""},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.skill.IsPlatformReference()
			if result != tt.expected {
				t.Errorf("IsPlatformReference() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestSkill_IsOrganizationReference(t *testing.T) {
	tests := []struct {
		name     string
		skill    Skill
		expected bool
	}{
		{
			name:     "platform skill",
			skill:    Platform("coding-best-practices"),
			expected: false,
		},
		{
			name:     "organization skill",
			skill:    Organization("my-org", "internal-docs"),
			expected: true,
		},
		{
			name:     "skill with org",
			skill:    Skill{Slug: "test", Org: "my-org"},
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.skill.IsOrganizationReference()
			if result != tt.expected {
				t.Errorf("IsOrganizationReference() = %v, want %v", result, tt.expected)
			}
		})
	}
}

func TestSkill_String(t *testing.T) {
	tests := []struct {
		name     string
		skill    Skill
		expected string
	}{
		{
			name:     "platform skill",
			skill:    Platform("coding-best-practices"),
			expected: "Skill(platform:coding-best-practices)",
		},
		{
			name:     "organization skill",
			skill:    Organization("my-org", "internal-docs"),
			expected: "Skill(org:internal-docs@my-org)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := tt.skill.String()
			if result != tt.expected {
				t.Errorf("String() = %v, want %v", result, tt.expected)
			}
		})
	}
}
