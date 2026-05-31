package harness

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

// PathRoutingProxy is a lightweight reverse proxy that routes requests based
// on URL path prefix, mirroring the production Istio HTTPRoute / Caddy config:
//   - /aiserver.v1* -> Netty BiDi proxy (h2c HTTP/2)
//   - everything else -> Tomcat HTTP port
//
// This allows the integration test runner to use a single ProxyEndpoint while
// the routing layer dispatches to the correct backend port.
type PathRoutingProxy struct {
	server   *http.Server
	listener net.Listener
}

// NewPathRoutingProxy creates and starts a path-routing reverse proxy.
// It listens on a free port and routes based on path prefix.
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
	bidiProxy := httputil.NewSingleHostReverseProxy(bidiURL)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/aiserver.v1") {
			bidiProxy.ServeHTTP(w, r)
		} else {
			tomcatProxy.ServeHTTP(w, r)
		}
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("listen: %w", err)
	}

	// Wrap in h2c handler so the proxy accepts cleartext HTTP/2 (h2c)
	// from the runner's connect-node transport without TLS.
	h2s := &http2.Server{}
	server := &http.Server{Handler: h2c.NewHandler(handler, h2s)}

	go server.Serve(listener) //nolint:errcheck

	return &PathRoutingProxy{
		server:   server,
		listener: listener,
	}, nil
}

// Address returns the proxy's listen address as an HTTP URL.
func (p *PathRoutingProxy) Address() string {
	return fmt.Sprintf("http://%s", p.listener.Addr().String())
}

// Close shuts down the proxy server.
func (p *PathRoutingProxy) Close() error {
	return p.server.Close()
}
