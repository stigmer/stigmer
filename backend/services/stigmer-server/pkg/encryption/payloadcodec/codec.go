// Package payloadcodec implements the decode-only Go half of the Stigmer
// Temporal payload-encryption contract (stigmer-cloud#227, stigmer#398).
//
// The TS runner encrypts every payload its workers hand to Temporal with an
// AES-256-GCM PayloadCodec (backend/services/runner/src/encryption/). The
// server never encrypts — its own histories (orchestrator workflows, signals,
// memos) stay plaintext and UI-readable — but it MUST be able to decode
// runner-produced payloads: the agent-execution workflow reads
// ExecuteDeepAgent/ExecuteCursor/EnsureThread activity results, and the MCP
// connect controller reads the connect workflow result on the client. With
// runner encryption enabled and no codec here, every agent execution and MCP
// connect fails on decode.
//
// Envelope (cross-SDK contract — byte-compatible with the TS codec and the
// Java decode-only codec in stigmer-cloud's temporal-starter, pinned by the
// conformance fixture in testdata/, a byte-for-byte copy of the one the TS
// and Java tests decrypt):
//
//	metadata: encoding          = "binary/encrypted"
//	          encryption-key-id = <key id that encrypted this payload>
//	data:     iv (12 bytes) ‖ AES-256-GCM(ciphertext ‖ tag (16 bytes))
//
// The plaintext is the serialized ORIGINAL Payload proto (metadata AND data),
// so decode restores the payload exactly — including its original encoding —
// with no side channel.
//
// Decode passes through payloads it did not encrypt: plaintext payloads from
// the server's own workers and pre-rollout in-flight histories keep working
// with zero migration. Everything else fails closed — unknown key id, missing
// key id, truncation, and GCM auth failure all error rather than surfacing
// bogus payloads.
//
// Two standing constraints this codec creates for server code:
//   - ApplicationFailure DETAILS from runner activities/workflows are
//     codec-encoded payloads. No Go code reads failure details today; any
//     future reader works only through a client carrying this codec.
//   - The same goes for workflow QUERY responses served by runner workers
//     (listen tasks can register query handlers); nothing queries them today.
package payloadcodec

import (
	"crypto/aes"
	"crypto/cipher"
	"fmt"

	commonpb "go.temporal.io/api/common/v1"
	"go.temporal.io/sdk/converter"
	"google.golang.org/protobuf/proto"
)

const (
	encodingMetadataKey    = "encoding"
	encryptedEncodingValue = "binary/encrypted"
	keyIDMetadataKey       = "encryption-key-id"

	// AES-GCM parameters shared with the TS and Java implementations.
	ivBytes      = 12
	authTagBytes = 16
)

// DecryptionCodec is a decode-only Temporal PayloadCodec: Encode is the
// identity (the server writes plaintext), Decode decrypts runner-produced
// payloads. Safe for concurrent use.
type DecryptionCodec struct {
	// Accepted decryption keys by key id — the runner's primary key plus,
	// during rotation windows, its predecessor.
	aeadByKeyID map[string]cipher.AEAD
}

var _ converter.PayloadCodec = (*DecryptionCodec)(nil)

// NewDecryptionCodec builds the codec from a loaded config (see
// LoadConfigFromEnv, which validates key material at boot).
func NewDecryptionCodec(cfg *Config) (*DecryptionCodec, error) {
	keys := []Key{cfg.Primary}
	if cfg.Secondary != nil {
		keys = append(keys, *cfg.Secondary)
	}

	aeadByKeyID := make(map[string]cipher.AEAD, len(keys))
	for _, k := range keys {
		block, err := aes.NewCipher(k.Material)
		if err != nil {
			return nil, fmt.Errorf("payload encryption key %q is invalid: %w", k.ID, err)
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("payload encryption key %q is invalid: %w", k.ID, err)
		}
		aeadByKeyID[k.ID] = gcm
	}
	return &DecryptionCodec{aeadByKeyID: aeadByKeyID}, nil
}

// NewDataConverter wraps Temporal's default data converter with the
// decode-only codec. Install it on client.Options.DataConverter — the client
// is the single choke point that covers all workers AND client-side reads
// (e.g. WorkflowRun.Get on the MCP connect workflow result).
func NewDataConverter(cfg *Config) (converter.DataConverter, error) {
	codec, err := NewDecryptionCodec(cfg)
	if err != nil {
		return nil, err
	}
	return converter.NewCodecDataConverter(converter.GetDefaultDataConverter(), codec), nil
}

// Encode is the identity: the server never encrypts its own payloads, so
// orchestrator histories stay plaintext and readable in the Temporal UI.
func (c *DecryptionCodec) Encode(payloads []*commonpb.Payload) ([]*commonpb.Payload, error) {
	return payloads, nil
}

// Decode decrypts encrypted payloads and passes everything else through.
func (c *DecryptionCodec) Decode(payloads []*commonpb.Payload) ([]*commonpb.Payload, error) {
	out := make([]*commonpb.Payload, len(payloads))
	for i, p := range payloads {
		decoded, err := c.decodePayload(p)
		if err != nil {
			return nil, err
		}
		out[i] = decoded
	}
	return out, nil
}

func (c *DecryptionCodec) decodePayload(payload *commonpb.Payload) (*commonpb.Payload, error) {
	if !isEncryptedPayload(payload) {
		return payload, nil
	}

	keyIDBytes, ok := payload.GetMetadata()[keyIDMetadataKey]
	if !ok || len(keyIDBytes) == 0 {
		return nil, fmt.Errorf(
			"encrypted payload is missing its %s metadata — refusing to decode", keyIDMetadataKey)
	}
	keyID := string(keyIDBytes)
	aead, ok := c.aeadByKeyID[keyID]
	if !ok {
		return nil, fmt.Errorf(
			"encrypted payload uses unknown key id %q — configure it as the primary or "+
				"secondary payload encryption key (rotation window?)", keyID)
	}

	data := payload.GetData()
	if len(data) < ivBytes+authTagBytes {
		return nil, fmt.Errorf(
			"encrypted payload under key id %q is truncated (%d bytes)", keyID, len(data))
	}

	// GCM auth failure means tampered ciphertext or a key that does not
	// match its advertised id. Never surface partially decrypted bytes.
	plaintext, err := aead.Open(nil, data[:ivBytes], data[ivBytes:], nil)
	if err != nil {
		return nil, fmt.Errorf(
			"failed to decrypt payload under key id %q — ciphertext is corrupt or the "+
				"configured key does not match", keyID)
	}

	original := &commonpb.Payload{}
	if err := proto.Unmarshal(plaintext, original); err != nil {
		return nil, fmt.Errorf(
			"decrypted payload under key id %q is not a valid Payload proto: %w", keyID, err)
	}
	return original, nil
}

func isEncryptedPayload(payload *commonpb.Payload) bool {
	return string(payload.GetMetadata()[encodingMetadataKey]) == encryptedEncodingValue
}
