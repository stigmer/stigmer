package encryption

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
)

const (
	// EnvKeyName is the environment variable name for the encryption key
	EnvKeyName = "STIGMER_ENCRYPTION_KEY"

	// KeyFileName is the default filename for the local key file
	KeyFileName = "encryption.key"

	// KeyFileDir is the directory under home for storing the key file
	KeyFileDir = ".stigmer"

	// KeyFilePermissions are the permissions for the key file (owner read/write only)
	KeyFilePermissions = 0600

	// KeyDirPermissions are the permissions for the key directory
	KeyDirPermissions = 0700
)

// GetOrCreateKey loads the encryption key with the following priority:
//
//  1. STIGMER_ENCRYPTION_KEY environment variable (Base64-encoded 32-byte key)
//  2. ~/.stigmer/encryption.key file (raw 32-byte key)
//  3. Auto-generate and persist to file if neither exists
//
// Returns nil if encryption should be disabled (no key available and
// auto-generation is not appropriate for the environment).
func GetOrCreateKey() ([]byte, error) {
	return GetOrCreateNamedKey(EnvKeyName, KeyFileName)
}

// GetOrCreateNamedKey is GetOrCreateKey generalized over the env var and key
// file name, so sibling key material (the runner-token signing key, oss#535)
// rides the same env-var -> ~/.stigmer file -> auto-generate convention
// instead of growing a divergent loader.
func GetOrCreateNamedKey(envVar, fileName string) ([]byte, error) {
	// 1. Check environment variable (highest priority)
	if envKey := os.Getenv(envVar); envKey != "" {
		key, err := base64.StdEncoding.DecodeString(envKey)
		if err != nil {
			return nil, fmt.Errorf("invalid Base64 encoding in %s: %w", envVar, err)
		}
		if len(key) != KeySize {
			return nil, fmt.Errorf("%s must be exactly 32 bytes (256 bits) when decoded, got %d bytes", envVar, len(key))
		}
		return key, nil
	}

	// 2. Check local file
	keyPath, err := getNamedKeyFilePath(fileName)
	if err != nil {
		return nil, err
	}

	if key, err := loadKeyFromFile(keyPath); err == nil {
		return key, nil
	}

	// 3. Auto-generate new key (for local development)
	// In production, the key should be configured via environment variable
	key, err := generateKey()
	if err != nil {
		return nil, fmt.Errorf("failed to generate key for %s: %w", fileName, err)
	}

	// Persist for future use
	if err := saveKeyToFile(keyPath, key); err != nil {
		// Log warning but don't fail - the key is still usable
		fmt.Fprintf(os.Stderr, "Warning: could not save key to %s: %v\n", keyPath, err)
	}

	return key, nil
}

// GetKey loads the encryption key without auto-generation.
// Returns nil if no key is configured.
// Use this in production where auto-generation is not desired.
func GetKey() ([]byte, error) {
	// 1. Check environment variable
	if envKey := os.Getenv(EnvKeyName); envKey != "" {
		key, err := base64.StdEncoding.DecodeString(envKey)
		if err != nil {
			return nil, fmt.Errorf("invalid Base64 encoding in %s: %w", EnvKeyName, err)
		}
		if len(key) != KeySize {
			return nil, fmt.Errorf("%s must be exactly 32 bytes (256 bits) when decoded, got %d bytes", EnvKeyName, len(key))
		}
		return key, nil
	}

	// 2. Check local file
	keyPath, err := getKeyFilePath()
	if err != nil {
		return nil, nil // No key file path available
	}

	key, err := loadKeyFromFile(keyPath)
	if err != nil {
		return nil, nil // No key file exists
	}

	return key, nil
}

// getKeyFilePath returns the path to the local key file (~/.stigmer/encryption.key)
func getKeyFilePath() (string, error) {
	return getNamedKeyFilePath(KeyFileName)
}

// getNamedKeyFilePath returns the path to a named key file under ~/.stigmer.
func getNamedKeyFilePath(fileName string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("could not determine home directory: %w", err)
	}
	return filepath.Join(home, KeyFileDir, fileName), nil
}

// loadKeyFromFile reads the raw key bytes from a file
func loadKeyFromFile(path string) ([]byte, error) {
	// Check file exists
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	// Verify secure permissions (owner read/write only)
	mode := info.Mode().Perm()
	if mode != KeyFilePermissions {
		return nil, fmt.Errorf("key file %s has insecure permissions %o, expected %o", path, mode, KeyFilePermissions)
	}

	// Read key
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Validate size
	if len(key) != KeySize {
		return nil, fmt.Errorf("key file %s has invalid size: expected %d bytes, got %d", path, KeySize, len(key))
	}

	return key, nil
}

// saveKeyToFile writes the raw key bytes to a file with secure permissions
func saveKeyToFile(path string, key []byte) error {
	// Ensure directory exists with secure permissions
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, KeyDirPermissions); err != nil {
		return fmt.Errorf("failed to create key directory: %w", err)
	}

	// Write key with secure permissions
	if err := os.WriteFile(path, key, KeyFilePermissions); err != nil {
		return fmt.Errorf("failed to write key file: %w", err)
	}

	return nil
}

// generateKey generates a cryptographically secure random 32-byte key
func generateKey() ([]byte, error) {
	key := make([]byte, KeySize)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	return key, nil
}

// GenerateKeyBase64 generates a new random encryption key and returns it
// as a Base64-encoded string suitable for use in environment variables.
// This is a helper for key generation - the key is not stored.
func GenerateKeyBase64() (string, error) {
	key, err := generateKey()
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(key), nil
}

// ValidateKeyBase64 validates that a Base64-encoded string represents
// a valid 32-byte encryption key.
func ValidateKeyBase64(encoded string) error {
	key, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("invalid Base64 encoding: %w", err)
	}
	if len(key) != KeySize {
		return fmt.Errorf("key must be exactly 32 bytes (256 bits), got %d bytes", len(key))
	}
	return nil
}
