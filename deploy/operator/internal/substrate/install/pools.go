// The key material Agent Substrate's control plane trusts: five certificate
// authorities and the key it signs actors' tokens with, each written once into
// a Secret in the format Substrate's components read.
//
// Substrate's own installer generates these with packages internal to its
// module, so the formats are reproduced here. Each must round-trip through
// those packages' JSON shapes field for field:
//
//   - a CA pool is {"CAs":[{"ID","SigningKeyPKCS8","RootCertificateDER"}],
//     "ActiveForSigning"}, beside tls.crt (the root, PEM) and tls.key (its
//     key, PKCS#8 PEM) in a kubernetes.io/tls Secret;
//   - the actor token pool is {"Authorities":[{"ID","Algorithm",
//     "SigningKeyPKCS8"}],"ActiveForSigning"}, in an Opaque Secret under
//     "pool", its ID the key's thumbprint: base64url(SHA-256(PKIX public
//     key)).
//
// The roots last ten years, not Substrate's installer's one: nothing rotates
// them yet, and an install should not stop issuing identities on its first
// birthday. The certificates issued under them stay short-lived.

package install

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"time"

	corev1 "k8s.io/api/core/v1"
)

// RootValidity is how long a generated root stays valid.
const RootValidity = 10 * 365 * 24 * time.Hour

// poolKeyID is the ID of the one CA in a generated pool, as Substrate's
// installer names it.
const poolKeyID = "1"

// keyType is the key a pool's root signs with.
type keyType int

const (
	keyEd25519 keyType = iota
	keyECDSAP256
)

type wireCAPool struct {
	CAs              []wireCA
	ActiveForSigning string
}

type wireCA struct {
	ID                 string
	SigningKeyPKCS8    []byte
	RootCertificateDER []byte
}

type wireJWTPool struct {
	Authorities      []wireAuthority
	ActiveForSigning string
}

type wireAuthority struct {
	ID              string
	Algorithm       string
	SigningKeyPKCS8 []byte
}

// newCAPool generates one root and returns a CA pool Secret's data.
func newCAPool(kt keyType, now time.Time) (map[string][]byte, error) {
	var signer crypto.Signer
	switch kt {
	case keyEd25519:
		_, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("generating an Ed25519 root key: %w", err)
		}
		signer = key
	case keyECDSAP256:
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, fmt.Errorf("generating a P-256 root key: %w", err)
		}
		signer = key
	default:
		return nil, fmt.Errorf("unknown key type %d", kt)
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("generating a serial number: %w", err)
	}
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: rand.Text()},
		NotBefore:             now,
		NotAfter:              now.Add(RootValidity),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, signer.Public(), signer)
	if err != nil {
		return nil, fmt.Errorf("signing the root certificate: %w", err)
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(signer)
	if err != nil {
		return nil, fmt.Errorf("encoding the root key: %w", err)
	}
	pool, err := json.Marshal(wireCAPool{
		CAs:              []wireCA{{ID: poolKeyID, SigningKeyPKCS8: pkcs8, RootCertificateDER: der}},
		ActiveForSigning: poolKeyID,
	})
	if err != nil {
		return nil, fmt.Errorf("encoding the pool: %w", err)
	}
	return map[string][]byte{
		"pool":                  pool,
		corev1.TLSCertKey:       pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}),
		corev1.TLSPrivateKeyKey: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8}),
	}, nil
}

// newJWTPool generates the ES256 key actors' tokens are signed with and
// returns its Secret's data.
func newJWTPool() (map[string][]byte, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("generating the token signing key: %w", err)
	}
	id, err := thumbprint(&key.PublicKey)
	if err != nil {
		return nil, err
	}
	pkcs8, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, fmt.Errorf("encoding the token signing key: %w", err)
	}
	pool, err := json.Marshal(wireJWTPool{
		Authorities:      []wireAuthority{{ID: id, Algorithm: "ES256", SigningKeyPKCS8: pkcs8}},
		ActiveForSigning: id,
	})
	if err != nil {
		return nil, fmt.Errorf("encoding the token pool: %w", err)
	}
	return map[string][]byte{"pool": pool}, nil
}

// thumbprint is a public key's ID in a token pool.
func thumbprint(pub crypto.PublicKey) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return "", fmt.Errorf("encoding the public key: %w", err)
	}
	sum := sha256.Sum256(der)
	return base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// rootPEM is a CA pool's root certificate, PEM-encoded, read from its pool.
func rootPEM(pool []byte) ([]byte, error) {
	var wire wireCAPool
	if err := json.Unmarshal(pool, &wire); err != nil {
		return nil, fmt.Errorf("reading the CA pool: %w", err)
	}
	for _, ca := range wire.CAs {
		if ca.ID == wire.ActiveForSigning {
			return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ca.RootCertificateDER}), nil
		}
	}
	return nil, fmt.Errorf("the CA pool has no active CA %q", wire.ActiveForSigning)
}
