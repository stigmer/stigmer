package reconcile

import "testing"

func TestChangeType_String_Create(t *testing.T) {
	if ChangeTypeCreate.String() != "create" {
		t.Errorf("expected 'create', got %q", ChangeTypeCreate.String())
	}
}

func TestChangeType_String_Update(t *testing.T) {
	if ChangeTypeUpdate.String() != "update" {
		t.Errorf("expected 'update', got %q", ChangeTypeUpdate.String())
	}
}

func TestChangeType_String_Delete(t *testing.T) {
	if ChangeTypeDelete.String() != "delete" {
		t.Errorf("expected 'delete', got %q", ChangeTypeDelete.String())
	}
}

func TestChangeType_String_AllTypes(t *testing.T) {
	tests := []struct {
		changeType ChangeType
		expected   string
	}{
		{ChangeTypeCreate, "create"},
		{ChangeTypeUpdate, "update"},
		{ChangeTypeDelete, "delete"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if tt.changeType.String() != tt.expected {
				t.Errorf("expected %q, got %q", tt.expected, tt.changeType.String())
			}
		})
	}
}

func TestChangeType_IsValid(t *testing.T) {
	tests := []struct {
		name       string
		changeType ChangeType
		expected   bool
	}{
		{"create is valid", ChangeTypeCreate, true},
		{"update is valid", ChangeTypeUpdate, true},
		{"delete is valid", ChangeTypeDelete, true},
		{"zero value is invalid", ChangeType(0), false},
		{"negative is invalid", ChangeType(-1), false},
		{"large value is invalid", ChangeType(100), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.changeType.IsValid() != tt.expected {
				t.Errorf("expected IsValid() = %v for %v", tt.expected, tt.changeType)
			}
		})
	}
}

func TestChangeType_ZeroValue(t *testing.T) {
	var ct ChangeType

	t.Run("zero value is invalid", func(t *testing.T) {
		if ct.IsValid() {
			t.Error("expected zero value to be invalid")
		}
	})

	t.Run("zero value string is 'invalid'", func(t *testing.T) {
		if ct.String() != "invalid" {
			t.Errorf("expected 'invalid', got %q", ct.String())
		}
	})
}
