package encryption

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// testKey is a fixed 32-byte test key for deterministic tests
var testKey = []byte{
	0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
	0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
	0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
	0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
}

func TestNewSecretService(t *testing.T) {
	t.Run("valid key", func(t *testing.T) {
		svc, err := NewSecretService(testKey)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !svc.IsEnabled() {
			t.Error("expected service to be enabled")
		}
	})

	t.Run("nil key disables encryption", func(t *testing.T) {
		svc, err := NewSecretService(nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if svc.IsEnabled() {
			t.Error("expected service to be disabled")
		}
	})

	t.Run("empty key disables encryption", func(t *testing.T) {
		svc, err := NewSecretService([]byte{})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if svc.IsEnabled() {
			t.Error("expected service to be disabled")
		}
	})

	t.Run("invalid key size", func(t *testing.T) {
		_, err := NewSecretService([]byte{0x01, 0x02, 0x03}) // Too short
		if err == nil {
			t.Fatal("expected error for invalid key size")
		}
		if !strings.Contains(err.Error(), "32 bytes") {
			t.Errorf("error should mention 32 bytes: %v", err)
		}
	})
}

func TestEncryptDecrypt(t *testing.T) {
	svc, err := NewSecretService(testKey)
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	testCases := []struct {
		name      string
		plaintext string
	}{
		{"simple string", "hello world"},
		{"empty string", ""},
		{"unicode", "こんにちは世界"},
		{"special chars", "!@#$%^&*()_+-={}[]|\\:\";<>?,./"},
		{"long string", strings.Repeat("abcdefghij", 1000)},
		{"json-like", `{"key": "value", "secret": "password123"}`},
		{"newlines", "line1\nline2\nline3"},
		{"api key format", "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
		{"aws secret", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			encrypted, err := svc.Encrypt(tc.plaintext)
			if err != nil {
				t.Fatalf("encryption failed: %v", err)
			}

			// Verify encrypted format
			if !strings.HasPrefix(encrypted, EncryptedPrefix) {
				t.Errorf("encrypted value should have prefix %q, got %q", EncryptedPrefix, encrypted)
			}

			// Verify it's different from plaintext (except empty string)
			if tc.plaintext != "" && encrypted == tc.plaintext {
				t.Error("encrypted value should differ from plaintext")
			}

			// Decrypt and verify
			decrypted, err := svc.Decrypt(encrypted)
			if err != nil {
				t.Fatalf("decryption failed: %v", err)
			}

			if decrypted != tc.plaintext {
				t.Errorf("decrypted value mismatch: got %q, want %q", decrypted, tc.plaintext)
			}
		})
	}
}

func TestUniqueNonces(t *testing.T) {
	svc, err := NewSecretService(testKey)
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	plaintext := "same plaintext"
	encrypted1, _ := svc.Encrypt(plaintext)
	encrypted2, _ := svc.Encrypt(plaintext)

	if encrypted1 == encrypted2 {
		t.Error("encrypting same plaintext twice should produce different ciphertexts (unique nonces)")
	}

	// Both should decrypt to the same plaintext
	decrypted1, _ := svc.Decrypt(encrypted1)
	decrypted2, _ := svc.Decrypt(encrypted2)

	if decrypted1 != plaintext || decrypted2 != plaintext {
		t.Error("both encrypted values should decrypt to original plaintext")
	}
}

func TestIsEncrypted(t *testing.T) {
	svc, _ := NewSecretService(testKey)

	tests := []struct {
		value    string
		expected bool
	}{
		{EncryptedPrefix + "base64data", true},
		{"enc:v1:SGVsbG8gV29ybGQ=", true},
		{"plaintext", false},
		// Family-wide on purpose (oss#395): an unmatched future version
		// would be treated as plaintext and fail OPEN at every dispatch
		// site — returned verbatim on read, passed through on encrypt.
		{"enc:v2:future-version", true},
		{"enc:v99:whatever", true},
		{"", false},
		{"enc:", false},
		{"enc:v1", false},
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			result := svc.IsEncrypted(tt.value)
			if result != tt.expected {
				t.Errorf("IsEncrypted(%q) = %v, want %v", tt.value, result, tt.expected)
			}
		})
	}
}

func TestIsCiphertextShaped(t *testing.T) {
	tests := []struct {
		value    string
		expected bool
	}{
		{"enc:v1:SGVsbG8=", true},
		{"enc:v2:anything", true},
		{"enc:v99:anything", true},
		{"plaintext", false},
		{"", false},
		{"enc:v:missing-number", false},
		{"enc:vX:not-a-number", false},
		{" enc:v1:leading-space", false},        // prefix must be anchored
		{"my secret enc:v1: mid-string", false}, // not a prefix
		{"ENC:V1:upper", false},                 // the sentinel is lowercase
	}

	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			if got := IsCiphertextShaped(tt.value); got != tt.expected {
				t.Errorf("IsCiphertextShaped(%q) = %v, want %v", tt.value, got, tt.expected)
			}
		})
	}
}

// A stored value in an unknown enc:v<N>: version must fail decrypt loudly
// (ErrInvalidCiphertext), never be returned verbatim as if it were
// plaintext — the fail-closed half of the family-wide IsEncrypted.
func TestDecryptUnknownVersionFailsLoudly(t *testing.T) {
	svc, _ := NewSecretService(testKey)

	_, err := svc.Decrypt("enc:v2:c29tZS1mdXR1cmUtZm9ybWF0")
	if err == nil {
		t.Fatal("decrypting an unknown-version value must fail, not pass through")
	}
}

func TestDoubleEncryption(t *testing.T) {
	svc, _ := NewSecretService(testKey)

	plaintext := "secret value"
	encrypted1, _ := svc.Encrypt(plaintext)
	encrypted2, _ := svc.Encrypt(encrypted1) // Try to encrypt again

	// Should not double-encrypt
	if encrypted1 != encrypted2 {
		t.Error("encrypting an already-encrypted value should return it unchanged")
	}
}

func TestDecryptNonEncrypted(t *testing.T) {
	svc, _ := NewSecretService(testKey)

	// Decrypting non-encrypted value should return it as-is
	plaintext := "not encrypted"
	result, err := svc.Decrypt(plaintext)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != plaintext {
		t.Errorf("got %q, want %q", result, plaintext)
	}
}

func TestTamperedCiphertext(t *testing.T) {
	svc, _ := NewSecretService(testKey)

	encrypted, _ := svc.Encrypt("secret")

	// Tamper with the ciphertext
	tampered := encrypted[:len(encrypted)-2] + "XX"

	_, err := svc.Decrypt(tampered)
	if err == nil {
		t.Error("expected error when decrypting tampered ciphertext")
	}
}

func TestWrongKey(t *testing.T) {
	svc1, _ := NewSecretService(testKey)

	// Different key
	key2 := make([]byte, 32)
	copy(key2, testKey)
	key2[0] = 0xFF
	svc2, _ := NewSecretService(key2)

	encrypted, _ := svc1.Encrypt("secret")

	_, err := svc2.Decrypt(encrypted)
	if err == nil {
		t.Error("expected error when decrypting with wrong key")
	}
}

func TestDisabledEncryption(t *testing.T) {
	svc, _ := NewSecretService(nil)

	t.Run("encrypt returns plaintext", func(t *testing.T) {
		plaintext := "secret"
		result, err := svc.Encrypt(plaintext)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result != plaintext {
			t.Errorf("disabled encryption should return plaintext, got %q", result)
		}
	})

	t.Run("decrypt returns plaintext for non-encrypted", func(t *testing.T) {
		plaintext := "not encrypted"
		result, err := svc.Decrypt(plaintext)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if result != plaintext {
			t.Errorf("got %q, want %q", result, plaintext)
		}
	})

	t.Run("decrypt fails for encrypted value", func(t *testing.T) {
		// Try to decrypt something that looks encrypted
		_, err := svc.Decrypt(EncryptedPrefix + "somedata")
		if err != ErrEncryptionDisabled {
			t.Errorf("expected ErrEncryptionDisabled, got %v", err)
		}
	})
}

func TestValidateKeyBase64(t *testing.T) {
	t.Run("valid key", func(t *testing.T) {
		encoded := base64.StdEncoding.EncodeToString(testKey)
		if err := ValidateKeyBase64(encoded); err != nil {
			t.Errorf("unexpected error: %v", err)
		}
	})

	t.Run("invalid base64", func(t *testing.T) {
		if err := ValidateKeyBase64("not-valid-base64!!!"); err == nil {
			t.Error("expected error for invalid base64")
		}
	})

	t.Run("wrong size", func(t *testing.T) {
		encoded := base64.StdEncoding.EncodeToString([]byte("too short"))
		err := ValidateKeyBase64(encoded)
		if err == nil {
			t.Error("expected error for wrong size")
		}
		if !strings.Contains(err.Error(), "32 bytes") {
			t.Errorf("error should mention 32 bytes: %v", err)
		}
	})
}

func TestGenerateKeyBase64(t *testing.T) {
	encoded, err := GenerateKeyBase64()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should be valid
	if err := ValidateKeyBase64(encoded); err != nil {
		t.Errorf("generated key should be valid: %v", err)
	}

	// Generate another - should be different
	encoded2, _ := GenerateKeyBase64()
	if encoded == encoded2 {
		t.Error("generated keys should be unique")
	}
}

func TestGetOrCreateKey(t *testing.T) {
	// Clear environment for test
	originalEnv := os.Getenv(EnvKeyName)
	defer os.Setenv(EnvKeyName, originalEnv)

	t.Run("from environment variable", func(t *testing.T) {
		encoded := base64.StdEncoding.EncodeToString(testKey)
		os.Setenv(EnvKeyName, encoded)

		key, err := GetOrCreateKey()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if string(key) != string(testKey) {
			t.Error("key should match environment variable")
		}
	})

	t.Run("invalid base64 in env", func(t *testing.T) {
		os.Setenv(EnvKeyName, "not-valid-base64!!!")

		_, err := GetOrCreateKey()
		if err == nil {
			t.Error("expected error for invalid base64")
		}
	})

	t.Run("wrong size in env", func(t *testing.T) {
		encoded := base64.StdEncoding.EncodeToString([]byte("too short"))
		os.Setenv(EnvKeyName, encoded)

		_, err := GetOrCreateKey()
		if err == nil {
			t.Error("expected error for wrong size")
		}
	})
}

func TestKeyFileOperations(t *testing.T) {
	// Create temp directory for test
	tmpDir, err := os.MkdirTemp("", "encryption-test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	keyPath := filepath.Join(tmpDir, "test.key")

	t.Run("save and load key", func(t *testing.T) {
		err := saveKeyToFile(keyPath, testKey)
		if err != nil {
			t.Fatalf("failed to save key: %v", err)
		}

		// Verify permissions
		info, err := os.Stat(keyPath)
		if err != nil {
			t.Fatalf("failed to stat key file: %v", err)
		}
		if info.Mode().Perm() != KeyFilePermissions {
			t.Errorf("key file permissions = %o, want %o", info.Mode().Perm(), KeyFilePermissions)
		}

		loaded, err := loadKeyFromFile(keyPath)
		if err != nil {
			t.Fatalf("failed to load key: %v", err)
		}

		if string(loaded) != string(testKey) {
			t.Error("loaded key should match saved key")
		}
	})

	t.Run("reject insecure permissions", func(t *testing.T) {
		insecurePath := filepath.Join(tmpDir, "insecure.key")
		os.WriteFile(insecurePath, testKey, 0644) // Wrong permissions

		_, err := loadKeyFromFile(insecurePath)
		if err == nil {
			t.Error("expected error for insecure permissions")
		}
		if !strings.Contains(err.Error(), "insecure permissions") {
			t.Errorf("error should mention insecure permissions: %v", err)
		}
	})

	t.Run("reject wrong size", func(t *testing.T) {
		wrongSizePath := filepath.Join(tmpDir, "wrongsize.key")
		os.WriteFile(wrongSizePath, []byte("too short"), 0600)

		_, err := loadKeyFromFile(wrongSizePath)
		if err == nil {
			t.Error("expected error for wrong size")
		}
	})
}

// TestCrossLanguageCompatibility verifies that values encrypted with this
// implementation can be decrypted by the Java implementation and vice versa.
// This test uses fixed test vectors that should match the Java tests.
func TestCrossLanguageCompatibility(t *testing.T) {
	// This key is used in both Java and Go tests
	// Base64: MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=
	compatKey := []byte("01234567890123456789012345678901")

	svc, err := NewSecretService(compatKey)
	if err != nil {
		t.Fatalf("failed to create service: %v", err)
	}

	// Test that we can encrypt and decrypt
	testCases := []string{
		"super-secret-token",
		"ghp_1234567890abcdefghijklmnopqrstuvwxyz",
		"",
		"unicode: こんにちは",
	}

	for _, tc := range testCases {
		t.Run(tc, func(t *testing.T) {
			encrypted, err := svc.Encrypt(tc)
			if err != nil {
				t.Fatalf("encryption failed: %v", err)
			}

			decrypted, err := svc.Decrypt(encrypted)
			if err != nil {
				t.Fatalf("decryption failed: %v", err)
			}

			if decrypted != tc {
				t.Errorf("round-trip failed: got %q, want %q", decrypted, tc)
			}
		})
	}
}

// BenchmarkEncrypt measures encryption performance
func BenchmarkEncrypt(b *testing.B) {
	svc, _ := NewSecretService(testKey)
	plaintext := "this is a typical secret value that needs encryption"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = svc.Encrypt(plaintext)
	}
}

// BenchmarkDecrypt measures decryption performance
func BenchmarkDecrypt(b *testing.B) {
	svc, _ := NewSecretService(testKey)
	encrypted, _ := svc.Encrypt("this is a typical secret value that needs encryption")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = svc.Decrypt(encrypted)
	}
}
