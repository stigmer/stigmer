// Package keycloaktest is an in-memory stand-in for the parts of Keycloak's
// admin API the operator calls (internal/keycloak), for tests that converge
// a realm without running Keycloak. It keeps what is written, answers reads
// the way Keycloak shapes them (ids assigned on create, an SMTP password
// masked on read, the default user profile with its required names), and
// counts writes, so a test
// can prove that a pass over a converged realm writes nothing.
package keycloaktest

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
)

// Object is one representation.
type Object = map[string]any

// Fake is the stand-in server.
type Fake struct {
	*httptest.Server
	Username, Password string

	mu       sync.Mutex
	realms   map[string]Object
	clients  map[string][]Object
	mappers  map[string][]Object
	users    map[string][]Object
	profiles map[string]Object
	writes   int
	nextID   int
}

// New starts a fake that admits the given admin credential.
func New(username, password string) *Fake {
	f := &Fake{
		Username: username, Password: password,
		realms: map[string]Object{}, clients: map[string][]Object{}, mappers: map[string][]Object{},
		users: map[string][]Object{}, profiles: map[string]Object{},
	}
	f.Server = httptest.NewServer(http.HandlerFunc(f.serve))
	return f
}

// Writes is how many writes the fake has taken.
func (f *Fake) Writes() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.writes
}

// Realm is the realm as stored.
func (f *Fake) Realm(name string) Object {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.realms[name]
}

// Client is a realm's client by clientId, as stored: a test changes it in
// place, as someone in Keycloak's console would, between passes.
func (f *Fake) Client(realm, clientID string) Object {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.clients[realm] {
		if c["clientId"] == clientID {
			return c
		}
	}
	return nil
}

// Mappers are a client's protocol mappers, by clientId.
func (f *Fake) Mappers(realm, clientID string) []Object {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, c := range f.clients[realm] {
		if c["clientId"] == clientID {
			return f.mappers[c["id"].(string)]
		}
	}
	return nil
}

// User is a realm's user by email, as stored (changed in place like Client).
func (f *Fake) User(realm, email string) Object {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, u := range f.users[realm] {
		if u["email"] == email {
			return u
		}
	}
	return nil
}

// Profile is a realm's user profile.
func (f *Fake) Profile(realm string) Object {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.profiles[realm]
}

func (f *Fake) id() string {
	f.nextID++
	return fmt.Sprintf("id-%d", f.nextID)
}

func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v != nil {
		_ = json.NewEncoder(w).Encode(v)
	}
}

func clone(o Object) Object {
	b, _ := json.Marshal(o)
	var out Object
	_ = json.Unmarshal(b, &out)
	return out
}

func (f *Fake) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	path := strings.TrimPrefix(r.URL.Path, "/idp")
	if path == "/realms/master/protocol/openid-connect/token" {
		_ = r.ParseForm()
		if r.Form.Get("username") != f.Username || r.Form.Get("password") != f.Password {
			write(w, http.StatusUnauthorized, Object{"error": "invalid_grant"})
			return
		}
		write(w, http.StatusOK, Object{"access_token": "token"})
		return
	}
	if r.Header.Get("Authorization") != "Bearer token" {
		write(w, http.StatusUnauthorized, nil)
		return
	}
	var body Object
	if r.Body != nil && (r.Method == http.MethodPost || r.Method == http.MethodPut) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		f.writes++
	}
	parts := strings.Split(strings.TrimPrefix(path, "/admin/realms"), "/")
	// parts[0] is "" ; parts[1] the realm.
	switch {
	case len(parts) == 1 && r.Method == http.MethodPost:
		name, _ := body["realm"].(string)
		f.realms[name] = body
		f.profiles[name] = Object{"attributes": []any{
			Object{"name": "username"},
			Object{"name": "email", "validations": Object{"email": Object{}, "length": Object{"max": float64(255)}}},
			Object{"name": "firstName", "required": Object{"roles": []any{"admin", "user"}}},
			Object{"name": "lastName", "required": Object{"roles": []any{"admin", "user"}}},
		}}
		write(w, http.StatusCreated, nil)
	case len(parts) == 2:
		realm, ok := f.realms[parts[1]]
		if !ok {
			write(w, http.StatusNotFound, nil)
			return
		}
		if r.Method == http.MethodPut {
			for k, v := range body {
				realm[k] = v
			}
			write(w, http.StatusNoContent, nil)
			return
		}
		out := clone(realm)
		if smtp, ok := out["smtpServer"].(Object); ok && smtp["password"] != nil {
			smtp["password"] = "**********"
		}
		write(w, http.StatusOK, out)
	case len(parts) >= 3 && parts[2] == "clients":
		f.serveClients(w, r, parts[1], parts[3:], body)
	case len(parts) == 3 && parts[2] == "users":
		if r.Method == http.MethodPost {
			body["id"] = f.id()
			delete(body, "credentials")
			f.users[parts[1]] = append(f.users[parts[1]], body)
			write(w, http.StatusCreated, nil)
			return
		}
		email := r.URL.Query().Get("email")
		out := []Object{}
		for _, u := range f.users[parts[1]] {
			if strings.EqualFold(fmt.Sprint(u["email"]), email) {
				out = append(out, clone(u))
			}
		}
		write(w, http.StatusOK, out)
	case len(parts) == 4 && parts[2] == "users" && parts[3] == "profile":
		if r.Method == http.MethodPut {
			f.profiles[parts[1]] = body
			write(w, http.StatusOK, body)
			return
		}
		write(w, http.StatusOK, clone(f.profiles[parts[1]]))
	default:
		write(w, http.StatusNotFound, nil)
	}
}

func (f *Fake) serveClients(w http.ResponseWriter, r *http.Request, realm string, rest []string, body Object) {
	switch {
	case len(rest) == 0 && r.Method == http.MethodPost:
		body["id"] = f.id()
		f.clients[realm] = append(f.clients[realm], body)
		write(w, http.StatusCreated, nil)
	case len(rest) == 0:
		want := r.URL.Query().Get("clientId")
		out := []Object{}
		for _, c := range f.clients[realm] {
			if c["clientId"] == want {
				out = append(out, clone(c))
			}
		}
		write(w, http.StatusOK, out)
	case len(rest) == 1 && r.Method == http.MethodPut:
		for i, c := range f.clients[realm] {
			if c["id"] == rest[0] {
				body["id"] = rest[0]
				f.clients[realm][i] = body
			}
		}
		write(w, http.StatusNoContent, nil)
	case len(rest) == 3 && rest[1] == "protocol-mappers" && rest[2] == "models":
		if r.Method == http.MethodPost {
			body["id"] = f.id()
			f.mappers[rest[0]] = append(f.mappers[rest[0]], body)
			write(w, http.StatusCreated, nil)
			return
		}
		out := []Object{}
		for _, m := range f.mappers[rest[0]] {
			out = append(out, clone(m))
		}
		write(w, http.StatusOK, out)
	case len(rest) == 4 && rest[1] == "protocol-mappers" && r.Method == http.MethodPut:
		for i, m := range f.mappers[rest[0]] {
			if m["id"] == rest[3] {
				f.mappers[rest[0]][i] = body
			}
		}
		write(w, http.StatusNoContent, nil)
	default:
		write(w, http.StatusNotFound, nil)
	}
}
