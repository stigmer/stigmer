// Pins the key material's formats to the shapes Agent Substrate's
// components read (its internal localca and localjwtauthority packages): the
// JSON field names, a root that is a CA signing with the pool's own key for
// ten years, PEM copies that match the pool, and a token pool whose ID is its
// key's thumbprint. A drift here would leave Substrate unable to start, so
// each field is checked by its wire name, not through this package's types.

package install

import (
	"bytes"
	"crypto"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"testing"
	"time"
)

func TestCAPoolHasUpstreamsShape(t *testing.T) {
	now := time.Date(2026, 11, 21, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		kt   keyType
		key  func(any) bool
	}{
		{"ed25519", keyEd25519, func(k any) bool { _, ok := k.(ed25519.PrivateKey); return ok }},
		{"p256", keyECDSAP256, func(k any) bool { _, ok := k.(*ecdsa.PrivateKey); return ok }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := newCAPool(tc.kt, now)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]json.RawMessage
			if err := json.Unmarshal(data["pool"], &wire); err != nil {
				t.Fatal(err)
			}
			if len(wire) != 2 || wire["CAs"] == nil || string(wire["ActiveForSigning"]) != `"1"` {
				t.Fatalf("pool fields = %s, want exactly CAs and ActiveForSigning \"1\"", data["pool"])
			}
			var cas []map[string]json.RawMessage
			if err := json.Unmarshal(wire["CAs"], &cas); err != nil || len(cas) != 1 {
				t.Fatalf("CAs = %s, want one", wire["CAs"])
			}
			var id string
			var keyDER, certDER []byte
			if err := json.Unmarshal(cas[0]["ID"], &id); err != nil || id != "1" {
				t.Fatalf("CA ID = %s, want 1", cas[0]["ID"])
			}
			if err := json.Unmarshal(cas[0]["SigningKeyPKCS8"], &keyDER); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(cas[0]["RootCertificateDER"], &certDER); err != nil {
				t.Fatal(err)
			}
			key, err := x509.ParsePKCS8PrivateKey(keyDER)
			if err != nil || !tc.key(key) {
				t.Fatalf("signing key is %T (%v)", key, err)
			}
			cert, err := x509.ParseCertificate(certDER)
			if err != nil {
				t.Fatal(err)
			}
			if !cert.IsCA || cert.KeyUsage&x509.KeyUsageCertSign == 0 {
				t.Fatalf("root is not a signing CA: IsCA=%v usage=%v", cert.IsCA, cert.KeyUsage)
			}
			if got := cert.NotAfter.Sub(cert.NotBefore); got != RootValidity {
				t.Fatalf("root validity %v, want %v", got, RootValidity)
			}
			if err := cert.CheckSignatureFrom(cert); err != nil {
				t.Fatalf("root is not self-signed: %v", err)
			}
			pub := key.(crypto.Signer).Public()
			if !pub.(interface{ Equal(crypto.PublicKey) bool }).Equal(cert.PublicKey) {
				t.Fatal("the root's public key is not the pool's key's")
			}
			if block, _ := pem.Decode(data["tls.crt"]); block == nil || !bytes.Equal(block.Bytes, certDER) {
				t.Fatal("tls.crt is not the pool's root")
			}
			if block, _ := pem.Decode(data["tls.key"]); block == nil || block.Type != "PRIVATE KEY" || !bytes.Equal(block.Bytes, keyDER) {
				t.Fatal("tls.key is not the pool's key in PKCS#8")
			}
			root, err := rootPEM(data["pool"])
			if err != nil || !bytes.Equal(root, data["tls.crt"]) {
				t.Fatalf("rootPEM = %q, %v; want tls.crt", root, err)
			}
		})
	}
}

func TestJWTPoolIDIsTheKeysThumbprint(t *testing.T) {
	data, err := newJWTPool()
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Authorities []struct {
			ID              string
			Algorithm       string
			SigningKeyPKCS8 []byte
		}
		ActiveForSigning string
	}
	if err := json.Unmarshal(data["pool"], &wire); err != nil {
		t.Fatal(err)
	}
	if len(wire.Authorities) != 1 || wire.Authorities[0].Algorithm != "ES256" {
		t.Fatalf("authorities = %+v, want one ES256", wire.Authorities)
	}
	a := wire.Authorities[0]
	key, err := x509.ParsePKCS8PrivateKey(a.SigningKeyPKCS8)
	if err != nil {
		t.Fatal(err)
	}
	want, err := thumbprint(key.(*ecdsa.PrivateKey).Public())
	if err != nil {
		t.Fatal(err)
	}
	if a.ID != want || wire.ActiveForSigning != want {
		t.Fatalf("ID %q, active %q; want the thumbprint %q", a.ID, wire.ActiveForSigning, want)
	}
}
