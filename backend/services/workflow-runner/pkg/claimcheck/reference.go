package claimcheck

import (
	"encoding/json"
	"fmt"
	"time"
)

// ClaimCheckRef represents a reference to externally stored payload
type ClaimCheckRef struct {
	Type       string `json:"_type"`       // Always "claim_check_ref"
	Key        string `json:"key"`         // Storage key (UUID)
	SizeBytes  int64  `json:"size_bytes"`  // Original payload size
	Compressed bool   `json:"compressed"`  // Was payload compressed?
	StoredAt   string `json:"stored_at"`   // ISO 8601 timestamp
}

// IsClaimCheckRef checks if interface{} is a claim check reference
func IsClaimCheckRef(value interface{}) bool {
	if value == nil {
		return false
	}

	// Try type assertion
	if _, ok := value.(ClaimCheckRef); ok {
		return true
	}

	// Try pointer type assertion
	if _, ok := value.(*ClaimCheckRef); ok {
		return true
	}

	// Try map (JSON deserialization)
	if m, ok := value.(map[string]interface{}); ok {
		typeVal, exists := m["_type"]
		return exists && typeVal == "claim_check_ref"
	}

	return false
}

// ToClaimCheckRef converts interface{} to ClaimCheckRef
func ToClaimCheckRef(value interface{}) (ClaimCheckRef, error) {
	// Direct type
	if ref, ok := value.(ClaimCheckRef); ok {
		return ref, nil
	}

	// Pointer type
	if ref, ok := value.(*ClaimCheckRef); ok {
		return *ref, nil
	}

	// From map (JSON)
	if m, ok := value.(map[string]interface{}); ok {
		data, err := json.Marshal(m)
		if err != nil {
			return ClaimCheckRef{}, fmt.Errorf("failed to marshal map: %w", err)
		}

		var ref ClaimCheckRef
		err = json.Unmarshal(data, &ref)
		if err != nil {
			return ClaimCheckRef{}, fmt.Errorf("failed to unmarshal reference: %w", err)
		}

		return ref, nil
	}

	return ClaimCheckRef{}, fmt.Errorf("value is not a claim check reference")
}

// CreateReference creates a new claim check reference
func CreateReference(key string, originalSize int64, compressed bool) ClaimCheckRef {
	return ClaimCheckRef{
		Type:       "claim_check_ref",
		Key:        key,
		SizeBytes:  originalSize,
		Compressed: compressed,
		StoredAt:   time.Now().UTC().Format(time.RFC3339),
	}
}
