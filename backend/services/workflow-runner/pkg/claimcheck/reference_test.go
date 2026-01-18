package claimcheck_test

import (
	"encoding/json"
	"testing"

	"github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIsClaimCheckRef(t *testing.T) {
	ref := claimcheck.CreateReference("uuid-123", 1024, true)
	assert.True(t, claimcheck.IsClaimCheckRef(ref))

	notRef := "just a string"
	assert.False(t, claimcheck.IsClaimCheckRef(notRef))
}

func TestIsClaimCheckRef_Pointer(t *testing.T) {
	ref := claimcheck.CreateReference("uuid-123", 1024, true)
	assert.True(t, claimcheck.IsClaimCheckRef(&ref))
}

func TestIsClaimCheckRef_Map(t *testing.T) {
	refMap := map[string]interface{}{
		"_type":      "claim_check_ref",
		"key":        "uuid-123",
		"size_bytes": 1024,
		"compressed": true,
		"stored_at":  "2026-01-08T10:00:00Z",
	}
	assert.True(t, claimcheck.IsClaimCheckRef(refMap))
}

func TestIsClaimCheckRef_Nil(t *testing.T) {
	assert.False(t, claimcheck.IsClaimCheckRef(nil))
}

func TestToClaimCheckRef_DirectType(t *testing.T) {
	original := claimcheck.CreateReference("uuid-456", 2048, false)

	converted, err := claimcheck.ToClaimCheckRef(original)
	require.NoError(t, err)
	assert.Equal(t, original, converted)
}

func TestToClaimCheckRef_Pointer(t *testing.T) {
	original := claimcheck.CreateReference("uuid-456", 2048, false)

	converted, err := claimcheck.ToClaimCheckRef(&original)
	require.NoError(t, err)
	assert.Equal(t, original, converted)
}

func TestToClaimCheckRef_FromJSON(t *testing.T) {
	jsonData := `{
		"_type": "claim_check_ref",
		"key": "uuid-789",
		"size_bytes": 4096,
		"compressed": true,
		"stored_at": "2026-01-08T10:00:00Z"
	}`

	var m map[string]interface{}
	err := json.Unmarshal([]byte(jsonData), &m)
	require.NoError(t, err)

	ref, err := claimcheck.ToClaimCheckRef(m)
	require.NoError(t, err)

	assert.Equal(t, "claim_check_ref", ref.Type)
	assert.Equal(t, "uuid-789", ref.Key)
	assert.Equal(t, int64(4096), ref.SizeBytes)
	assert.True(t, ref.Compressed)
}

func TestToClaimCheckRef_InvalidType(t *testing.T) {
	_, err := claimcheck.ToClaimCheckRef("not a reference")
	assert.Error(t, err)
}

func TestCreateReference(t *testing.T) {
	ref := claimcheck.CreateReference("test-key", 1024, true)

	assert.Equal(t, "claim_check_ref", ref.Type)
	assert.Equal(t, "test-key", ref.Key)
	assert.Equal(t, int64(1024), ref.SizeBytes)
	assert.True(t, ref.Compressed)
	assert.NotEmpty(t, ref.StoredAt)
}

func TestClaimCheckRef_JSONSerialization(t *testing.T) {
	original := claimcheck.CreateReference("test-key", 2048, false)

	// Serialize to JSON
	jsonData, err := json.Marshal(original)
	require.NoError(t, err)

	// Deserialize from JSON
	var restored claimcheck.ClaimCheckRef
	err = json.Unmarshal(jsonData, &restored)
	require.NoError(t, err)

	assert.Equal(t, original, restored)
}
