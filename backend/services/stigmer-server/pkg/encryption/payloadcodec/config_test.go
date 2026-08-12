package payloadcodec

import (
	"encoding/base64"
	"testing"

	"github.com/stretchr/testify/require"
)

func validKeyBase64(seed byte) string {
	key := make([]byte, aes256KeyBytes)
	for i := range key {
		key[i] = seed
	}
	return base64.StdEncoding.EncodeToString(key)
}

func clearEncryptionEnv(t *testing.T) {
	t.Helper()
	// t.Setenv registers cleanup AND marks the test as non-parallel, which
	// matters here: these tests mutate process-global env.
	for _, name := range []string{keyEnv, keyIDEnv, secondaryKeyEnv, secondaryKeyIDEnv} {
		t.Setenv(name, "")
	}
}

func TestLoadConfigReturnsNilWhenUnset(t *testing.T) {
	clearEncryptionEnv(t)

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	require.Nil(t, cfg, "encryption must be off when no key is configured")
}

func TestLoadConfigPrimaryOnly(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, validKeyBase64(0x11))
	t.Setenv(keyIDEnv, "key-2026-08")

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	require.Equal(t, "key-2026-08", cfg.Primary.ID)
	require.Len(t, cfg.Primary.Material, aes256KeyBytes)
	require.Nil(t, cfg.Secondary)
}

func TestLoadConfigWithSecondary(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, validKeyBase64(0x11))
	t.Setenv(keyIDEnv, "key-new")
	t.Setenv(secondaryKeyEnv, validKeyBase64(0x22))
	t.Setenv(secondaryKeyIDEnv, "key-old")

	cfg, err := LoadConfigFromEnv()
	require.NoError(t, err)
	require.Equal(t, "key-new", cfg.Primary.ID)
	require.NotNil(t, cfg.Secondary)
	require.Equal(t, "key-old", cfg.Secondary.ID)
}

func TestLoadConfigFailsWithoutKeyID(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, validKeyBase64(0x11))

	_, err := LoadConfigFromEnv()
	require.ErrorContains(t, err, "STIGMER_PAYLOAD_ENCRYPTION_KEY_ID is required")
}

func TestLoadConfigFailsOnInvalidBase64(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, "not-valid-base64!!!")
	t.Setenv(keyIDEnv, "key-1")

	_, err := LoadConfigFromEnv()
	require.ErrorContains(t, err, "is not valid base64")
}

func TestLoadConfigFailsOnWrongKeyLength(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, base64.StdEncoding.EncodeToString([]byte("too-short")))
	t.Setenv(keyIDEnv, "key-1")

	_, err := LoadConfigFromEnv()
	require.ErrorContains(t, err, "must decode to 32 bytes (AES-256)")
}

func TestLoadConfigFailsWhenSecondaryMissingItsID(t *testing.T) {
	clearEncryptionEnv(t)
	t.Setenv(keyEnv, validKeyBase64(0x11))
	t.Setenv(keyIDEnv, "key-new")
	t.Setenv(secondaryKeyEnv, validKeyBase64(0x22))

	_, err := LoadConfigFromEnv()
	require.ErrorContains(t, err, "STIGMER_PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID is required")
}
