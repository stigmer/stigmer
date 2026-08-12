package payloadcodec

import (
	"encoding/base64"
	"fmt"
	"os"
)

// Env var names are deliberately IDENTICAL to what the TS runner and the
// Java service read (DD-003): a self-hosted deployment sets one key pair for
// both processes, so the two consumers cannot rotate apart.
const (
	keyEnv            = "STIGMER_PAYLOAD_ENCRYPTION_KEY"
	keyIDEnv          = "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID"
	secondaryKeyEnv   = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY"
	secondaryKeyIDEnv = "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID"

	aes256KeyBytes = 32
)

// Key is one accepted decryption key.
type Key struct {
	// ID is the value payloads carry in their encryption-key-id metadata.
	ID string
	// Material is the raw 32-byte AES-256 key (validated at load).
	Material []byte
}

// Config holds the accepted decryption keys.
type Config struct {
	// Primary is the key the runner currently encrypts with.
	Primary Key
	// Secondary is the previous key, accepted during rotation windows.
	Secondary *Key
}

// LoadConfigFromEnv returns the payload-encryption config, or (nil, nil)
// when encryption is not configured (the codec is then simply not
// installed — the enabled-iff-configured pattern the runner uses).
//
// A present-but-malformed key, or a key without its id, is an error: an
// operator who set the key intended runner history to be encrypted, and the
// server would otherwise fail on the first runner payload it reads. Key
// misconfiguration must stop the boot, not surface later as decode errors.
func LoadConfigFromEnv() (*Config, error) {
	rawKey := os.Getenv(keyEnv)
	if rawKey == "" {
		return nil, nil
	}

	primary, err := loadKey(rawKey, keyEnv, keyIDEnv)
	if err != nil {
		return nil, err
	}
	cfg := &Config{Primary: *primary}

	if rawSecondary := os.Getenv(secondaryKeyEnv); rawSecondary != "" {
		secondary, err := loadKey(rawSecondary, secondaryKeyEnv, secondaryKeyIDEnv)
		if err != nil {
			return nil, err
		}
		cfg.Secondary = secondary
	}
	return cfg, nil
}

func loadKey(rawBase64, keyEnvName, keyIDEnvName string) (*Key, error) {
	// An explicit id is required (no default): during rotation two keys
	// coexist, and payloads must name which one encrypted them.
	keyID := os.Getenv(keyIDEnvName)
	if keyID == "" {
		return nil, fmt.Errorf(
			"payload encryption misconfigured: %s is required when %s is set",
			keyIDEnvName, keyEnvName)
	}

	material, err := base64.StdEncoding.DecodeString(rawBase64)
	if err != nil {
		return nil, fmt.Errorf(
			"payload encryption misconfigured: %s is not valid base64", keyEnvName)
	}
	if len(material) != aes256KeyBytes {
		return nil, fmt.Errorf(
			"payload encryption misconfigured: %s must decode to %d bytes (AES-256), got %d",
			keyEnvName, aes256KeyBytes, len(material))
	}
	return &Key{ID: keyID, Material: material}, nil
}
