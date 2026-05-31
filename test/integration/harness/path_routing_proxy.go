package harness

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/http2"
)

// PathRoutingProxy is a lightweight reverse proxy that routes requests based
// on URL path prefix, mirroring the production Istio HTTPRoute / Caddy config:
//   - /agent.v1*    -> Netty BiDi proxy (h2c HTTP/2) — AgentService Connect RPC
//   - /aiserver.v1* -> Netty BiDi proxy (h2c HTTP/2) — AnalyticsService Connect RPC
//   - everything else -> Tomcat HTTP port
//
// This allows the integration test runner to use a single ProxyEndpoint while
// the routing layer dispatches to the correct backend port.
type PathRoutingProxy struct {
	server   *http.Server
	listener net.Listener
}

// NewPathRoutingProxy creates and starts a path-routing reverse proxy
// serving HTTPS with a self-signed certificate. TLS is required because
// the Cursor SDK's connect-node transport uses HTTP/2 only over TLS
// (httpVersion:"2" for https:// URLs) — BiDi streaming requires HTTP/2.
//
// The runner process must set NODE_TLS_REJECT_UNAUTHORIZED=0 to accept
// the self-signed cert.
func NewPathRoutingProxy(tomcatAddr, bidiAddr string) (*PathRoutingProxy, error) {
	tomcatURL, err := url.Parse(tomcatAddr)
	if err != nil {
		return nil, fmt.Errorf("parse tomcat addr: %w", err)
	}
	bidiURL, err := url.Parse(bidiAddr)
	if err != nil {
		return nil, fmt.Errorf("parse bidi addr: %w", err)
	}

	tomcatProxy := httputil.NewSingleHostReverseProxy(tomcatURL)

	// The BiDi proxy (Netty) speaks h2c (HTTP/2 cleartext). Configure the
	// reverse proxy transport to use HTTP/2 with prior knowledge so it doesn't
	// attempt HTTP/1.1 to the h2c-only backend.
	h2cTransport := &http2.Transport{
		AllowHTTP: true,
		DialTLSContext: func(_ context.Context, network, addr string, _ *tls.Config) (net.Conn, error) {
			return net.Dial(network, addr)
		},
	}
	bidiProxy := httputil.NewSingleHostReverseProxy(bidiURL)
	bidiProxy.Transport = h2cTransport

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/agent.v1") || strings.HasPrefix(r.URL.Path, "/aiserver.v1") {
			bidiProxy.ServeHTTP(w, r)
		} else {
			tomcatProxy.ServeHTTP(w, r)
		}
	})

	tlsCert, err := generateSelfSignedCert()
	if err != nil {
		return nil, fmt.Errorf("generate self-signed cert: %w", err)
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{
		Certificates: []tls.Certificate{tlsCert},
		NextProtos:   []string{"h2", "http/1.1"},
	})
	if err != nil {
		return nil, fmt.Errorf("listen tls: %w", err)
	}

	server := &http.Server{Handler: handler}
	if err := http2.ConfigureServer(server, nil); err != nil {
		listener.Close()
		return nil, fmt.Errorf("configure http2: %w", err)
	}

	go server.Serve(listener) //nolint:errcheck

	return &PathRoutingProxy{
		server:   server,
		listener: listener,
	}, nil
}

// Address returns the proxy's listen address as an HTTPS URL.
func (p *PathRoutingProxy) Address() string {
	return fmt.Sprintf("https://%s", p.listener.Addr().String())
}

// generateSelfSignedCert creates an ephemeral TLS certificate for localhost.
func generateSelfSignedCert() (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "localhost"},
		IPAddresses:  []net.IP{net.IPv4(127, 0, 0, 1)},
		DNSNames:     []string{"localhost"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	certDER, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}

	return tls.Certificate{
		Certificate: [][]byte{certDER},
		PrivateKey:  key,
	}, nil
}

// Close shuts down the proxy server.
func (p *PathRoutingProxy) Close() error {
	return p.server.Close()
}
