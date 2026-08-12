package payloadcodec

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	commonpb "go.temporal.io/api/common/v1"
	"google.golang.org/protobuf/proto"
)

func testKey(t *testing.T, seed byte) []byte {
	t.Helper()
	key := make([]byte, aes256KeyBytes)
	for i := range key {
		key[i] = seed
	}
	return key
}

func testCodec(t *testing.T, cfg *Config) *DecryptionCodec {
	t.Helper()
	codec, err := NewDecryptionCodec(cfg)
	require.NoError(t, err)
	return codec
}

func plaintextPayload(data string) *commonpb.Payload {
	return &commonpb.Payload{
		Metadata: map[string][]byte{encodingMetadataKey: []byte("json/plain")},
		Data:     []byte(data),
	}
}

// encryptForTest mirrors the TS runner's encode: the serialized original
// Payload proto sealed as iv ‖ AES-256-GCM(ciphertext ‖ tag), with the
// envelope metadata. Kept test-only — this package must never grow a
// production encrypt path (decode-only is the design).
func encryptForTest(t *testing.T, original *commonpb.Payload, key []byte, keyID string) *commonpb.Payload {
	t.Helper()

	serialized, err := proto.Marshal(original)
	require.NoError(t, err)

	block, err := aes.NewCipher(key)
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)

	iv := make([]byte, ivBytes)
	_, err = rand.Read(iv)
	require.NoError(t, err)

	return &commonpb.Payload{
		Metadata: map[string][]byte{
			encodingMetadataKey: []byte(encryptedEncodingValue),
			keyIDMetadataKey:    []byte(keyID),
		},
		Data: append(append([]byte{}, iv...), gcm.Seal(nil, iv, serialized, nil)...),
	}
}

func TestDecodeRoundTrip(t *testing.T) {
	key := testKey(t, 0x11)
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: key}})

	original := plaintextPayload(`{"secret":"value"}`)
	encrypted := encryptForTest(t, original, key, "k1")

	decoded, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.NoError(t, err)
	require.Len(t, decoded, 1)
	require.True(t, proto.Equal(original, decoded[0]),
		"decode must restore the original payload exactly, metadata included")
}

func TestDecodePassesThroughPlaintext(t *testing.T) {
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: testKey(t, 0x11)}})

	// Plaintext payloads (the server's own histories, pre-rollout in-flight
	// executions) must survive decode untouched — the zero-migration property.
	payload := plaintextPayload(`{"plain":"data"}`)
	decoded, err := codec.Decode([]*commonpb.Payload{payload})
	require.NoError(t, err)
	require.Len(t, decoded, 1)
	require.Same(t, payload, decoded[0])
}

func TestEncodeIsIdentity(t *testing.T) {
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: testKey(t, 0x11)}})

	payloads := []*commonpb.Payload{plaintextPayload(`{"a":1}`), plaintextPayload(`{"b":2}`)}
	encoded, err := codec.Encode(payloads)
	require.NoError(t, err)
	require.Equal(t, payloads, encoded)
}

func TestDecodeWithSecondaryKeyDuringRotation(t *testing.T) {
	oldKey := testKey(t, 0x22)
	codec := testCodec(t, &Config{
		Primary:   Key{ID: "k2", Material: testKey(t, 0x11)},
		Secondary: &Key{ID: "k1", Material: oldKey},
	})

	original := plaintextPayload(`{"secret":"pre-rotation"}`)
	encrypted := encryptForTest(t, original, oldKey, "k1")

	decoded, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.NoError(t, err)
	require.True(t, proto.Equal(original, decoded[0]))
}

func TestDecodeFailsClosedOnUnknownKeyID(t *testing.T) {
	key := testKey(t, 0x11)
	codec := testCodec(t, &Config{Primary: Key{ID: "known", Material: key}})

	encrypted := encryptForTest(t, plaintextPayload(`{}`), key, "unknown")
	_, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.ErrorContains(t, err, `unknown key id "unknown"`)
}

func TestDecodeFailsClosedOnMissingKeyID(t *testing.T) {
	key := testKey(t, 0x11)
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: key}})

	encrypted := encryptForTest(t, plaintextPayload(`{}`), key, "k1")
	delete(encrypted.Metadata, keyIDMetadataKey)

	_, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.ErrorContains(t, err, "missing its encryption-key-id metadata")
}

func TestDecodeFailsClosedOnTruncatedData(t *testing.T) {
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: testKey(t, 0x11)}})

	truncated := &commonpb.Payload{
		Metadata: map[string][]byte{
			encodingMetadataKey: []byte(encryptedEncodingValue),
			keyIDMetadataKey:    []byte("k1"),
		},
		Data: make([]byte, ivBytes+authTagBytes-1),
	}
	_, err := codec.Decode([]*commonpb.Payload{truncated})
	require.ErrorContains(t, err, "truncated")
}

func TestDecodeFailsClosedOnTamperedCiphertext(t *testing.T) {
	key := testKey(t, 0x11)
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: key}})

	encrypted := encryptForTest(t, plaintextPayload(`{"secret":"value"}`), key, "k1")
	encrypted.Data[len(encrypted.Data)/2] ^= 0xff

	_, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.ErrorContains(t, err, "ciphertext is corrupt or the configured key does not match")
}

func TestDecodeFailsClosedOnWrongKeyForAdvertisedID(t *testing.T) {
	codec := testCodec(t, &Config{Primary: Key{ID: "k1", Material: testKey(t, 0x33)}})

	// Encrypted under a DIFFERENT key that advertises the same id.
	encrypted := encryptForTest(t, plaintextPayload(`{}`), testKey(t, 0x44), "k1")
	_, err := codec.Decode([]*commonpb.Payload{encrypted})
	require.ErrorContains(t, err, "ciphertext is corrupt or the configured key does not match")
}

// conformanceFixture mirrors the committed cross-language fixture's shape.
// The file is a byte-for-byte copy of the TS runner's
// __tests__/fixtures/encrypted-payload-fixture.json (also copied into
// stigmer-cloud's temporal-starter test resources) — the three
// implementations decrypt the SAME bytes, so envelope drift fails CI on
// whichever side drifted.
type conformanceFixture struct {
	KeyID     string `json:"keyId"`
	KeyBase64 string `json:"keyBase64"`
	Encrypted struct {
		MetadataBase64 map[string]string `json:"metadataBase64"`
		DataBase64     string            `json:"dataBase64"`
	} `json:"encrypted"`
	Original struct {
		DataJSON string `json:"dataJson"`
	} `json:"original"`
}

func TestCrossLanguageConformanceFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "encrypted-payload-fixture.json"))
	require.NoError(t, err)
	var fixture conformanceFixture
	require.NoError(t, json.Unmarshal(raw, &fixture))

	key, err := base64.StdEncoding.DecodeString(fixture.KeyBase64)
	require.NoError(t, err)
	codec := testCodec(t, &Config{Primary: Key{ID: fixture.KeyID, Material: key}})

	metadata := make(map[string][]byte, len(fixture.Encrypted.MetadataBase64))
	for k, v := range fixture.Encrypted.MetadataBase64 {
		metadata[k], err = base64.StdEncoding.DecodeString(v)
		require.NoError(t, err)
	}
	data, err := base64.StdEncoding.DecodeString(fixture.Encrypted.DataBase64)
	require.NoError(t, err)

	decoded, err := codec.Decode([]*commonpb.Payload{{Metadata: metadata, Data: data}})
	require.NoError(t, err)
	require.Len(t, decoded, 1)
	require.Equal(t, "json/plain", string(decoded[0].GetMetadata()[encodingMetadataKey]))
	require.JSONEq(t, fixture.Original.DataJSON, string(decoded[0].GetData()))
}
