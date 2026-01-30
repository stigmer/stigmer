// Package encryption provides AES-256-GCM encryption for environment secrets.
//
// This package is the Go equivalent of the Java EnvironmentSecretService,
// providing compatible encryption that allows secrets to be encrypted in
// one system and decrypted in the other.
//
// # Encryption Format
//
// Encrypted values are stored as versioned Base64-encoded strings:
//
//	enc:v1:<base64(nonce || ciphertext || tag)>
//
// Where:
//   - "enc:v1:" is a version prefix for future key rotation support
//   - nonce: 12 bytes (96 bits) - unique per encryption
//   - ciphertext: variable length - the encrypted data
//   - tag: 16 bytes (128 bits) - GCM authentication tag (appended by GCM)
//
// # Security Considerations
//
//   - Nonces are generated using crypto/rand
//   - Each encryption uses a unique nonce (critical for GCM security)
//   - The 256-bit key must be kept secret and securely managed
//
// # Cross-Platform Compatibility
//
// This implementation is compatible with the Java EnvironmentSecretService
// in stigmer-cloud. Both use identical:
//   - Algorithm: AES-256-GCM
//   - Nonce size: 12 bytes
//   - Tag size: 128 bits
//   - Format: versioned prefix + base64(nonce || ciphertext || tag)
package encryption

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

const (
	// GCMNonceSize is the nonce size for AES-GCM (12 bytes = 96 bits, NIST recommended)
	GCMNonceSize = 12

	// KeySize is the required key size for AES-256 (32 bytes = 256 bits)
	KeySize = 32

	// EncryptedPrefix is the version prefix for encrypted values.
	// This allows detection of encrypted values and supports future key rotation.
	EncryptedPrefix = "enc:v1:"
)

var (
	// ErrInvalidKeySize is returned when the encryption key is not 32 bytes
	ErrInvalidKeySize = errors.New("encryption key must be exactly 32 bytes (256 bits)")

	// ErrInvalidCiphertext is returned when the ciphertext is malformed
	ErrInvalidCiphertext = errors.New("invalid ciphertext format")

	// ErrDecryptionFailed is returned when decryption fails (wrong key or tampered data)
	ErrDecryptionFailed = errors.New("decryption failed - wrong key or tampered data")

	// ErrEncryptionDisabled is returned when trying to decrypt without a configured key
	ErrEncryptionDisabled = errors.New("encryption is not enabled - no key configured")
)

// SecretService provides encryption and decryption for environment secrets.
// It is safe for concurrent use.
type SecretService struct {
	gcm     cipher.AEAD
	enabled bool
}

// NewSecretService creates a new SecretService with the given 32-byte key.
// If key is nil or empty, the service operates in pass-through mode (no encryption).
func NewSecretService(key []byte) (*SecretService, error) {
	if len(key) == 0 {
		// No key provided - encryption disabled
		return &SecretService{
			gcm:     nil,
			enabled: false,
		}, nil
	}

	if len(key) != KeySize {
		return nil, fmt.Errorf("%w: got %d bytes", ErrInvalidKeySize, len(key))
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("failed to create AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("failed to create GCM: %w", err)
	}

	return &SecretService{
		gcm:     gcm,
		enabled: true,
	}, nil
}

// NewSecretServiceFromEnv creates a SecretService using the key from
// GetOrCreateKey(), which loads from environment or file.
func NewSecretServiceFromEnv() (*SecretService, error) {
	key, err := GetOrCreateKey()
	if err != nil {
		return nil, fmt.Errorf("failed to get encryption key: %w", err)
	}

	return NewSecretService(key)
}

// IsEnabled returns true if encryption is enabled (key is configured).
func (s *SecretService) IsEnabled() bool {
	return s.enabled
}

// Encrypt encrypts the plaintext string using AES-256-GCM.
// Returns a versioned Base64-encoded string: "enc:v1:<base64(nonce || ciphertext || tag)>"
//
// If encryption is disabled, returns the plaintext unchanged.
// If the value is already encrypted, returns it unchanged.
func (s *SecretService) Encrypt(plaintext string) (string, error) {
	if !s.enabled {
		return plaintext, nil
	}

	// Don't double-encrypt
	if s.IsEncrypted(plaintext) {
		return plaintext, nil
	}

	// Generate unique nonce for this encryption
	nonce := make([]byte, GCMNonceSize)
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("failed to generate nonce: %w", err)
	}

	// Encrypt: Seal appends the ciphertext and auth tag to the nonce
	ciphertext := s.gcm.Seal(nonce, nonce, []byte(plaintext), nil)

	// Encode and add version prefix
	encoded := base64.StdEncoding.EncodeToString(ciphertext)
	return EncryptedPrefix + encoded, nil
}

// Decrypt decrypts an encrypted value.
// Expects input in format: "enc:v1:<base64(nonce || ciphertext || tag)>"
//
// If the value is not encrypted (no prefix), returns it unchanged.
// This supports backward compatibility with existing plaintext values.
func (s *SecretService) Decrypt(encrypted string) (string, error) {
	// If not encrypted, return as-is (backward compatibility)
	if !s.IsEncrypted(encrypted) {
		return encrypted, nil
	}

	if !s.enabled {
		return "", ErrEncryptionDisabled
	}

	// Remove prefix and decode
	base64Data := strings.TrimPrefix(encrypted, EncryptedPrefix)
	ciphertext, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("%w: invalid base64 encoding", ErrInvalidCiphertext)
	}

	// Validate minimum length (nonce + at least 1 byte + tag)
	minLen := GCMNonceSize + 1 + s.gcm.Overhead()
	if len(ciphertext) < minLen {
		return "", fmt.Errorf("%w: ciphertext too short", ErrInvalidCiphertext)
	}

	// Extract nonce and encrypted data
	nonce := ciphertext[:GCMNonceSize]
	data := ciphertext[GCMNonceSize:]

	// Decrypt
	plaintext, err := s.gcm.Open(nil, nonce, data, nil)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrDecryptionFailed, err)
	}

	return string(plaintext), nil
}

// IsEncrypted checks if a value appears to be encrypted.
// Detection is based on the version prefix.
func (s *SecretService) IsEncrypted(value string) bool {
	return strings.HasPrefix(value, EncryptedPrefix)
}

// MustEncrypt is like Encrypt but panics on error.
// Use only in tests or where errors are unexpected.
func (s *SecretService) MustEncrypt(plaintext string) string {
	result, err := s.Encrypt(plaintext)
	if err != nil {
		panic(fmt.Sprintf("encryption failed: %v", err))
	}
	return result
}

// MustDecrypt is like Decrypt but panics on error.
// Use only in tests or where errors are unexpected.
func (s *SecretService) MustDecrypt(encrypted string) string {
	result, err := s.Decrypt(encrypted)
	if err != nil {
		panic(fmt.Sprintf("decryption failed: %v", err))
	}
	return result
}
