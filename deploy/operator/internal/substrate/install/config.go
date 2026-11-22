// What Substrate's installer writes beside the release's files: the key
// material, made once; and the configuration the API server, the object-store
// sidecars, telemetry and the database's setup read, made on every pass from
// the settings.
//
// The key material is created, never applied: an existing Secret is kept as
// it is, because every identity Substrate has issued chains to it. The one
// derived Secret, actor-id-ca-certs (the actor CA's root, for anyone
// verifying actors), is applied from its pool on every pass.
//
// The API server reads its settings at start, so the pod template carries a
// hash of them (ate.dev/env-hash, the same rule Substrate's installer uses).
// The hash is computed from what is rendered here, in a fixed order, so an
// unchanged install never restarts the API server and a changed one always
// does.
//
// Telemetry: the install has no collector, so components log to stdout
// (console), serve their own Prometheus metrics, and push nothing.

package install

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io/fs"
	"maps"
	"slices"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/yaml"

	"github.com/stigmer/stigmer/deploy/operator/internal/render"
)

// SnapshotStoreSecret holds the snapshot store's credentials in ate-system,
// where the object-store sidecars read them.
const SnapshotStoreSecret = "snapshot-store-credentials"

const (
	snapshotStoreAccessKeyID     = "AWS_ACCESS_KEY_ID"
	snapshotStoreSecretAccessKey = "AWS_SECRET_ACCESS_KEY"
)

// The bundled database's schema, roles and certificate-only login users, as
// Substrate's installer names them.
const (
	postgresSchema        = "substrate"
	postgresOwnerRole     = "substrate_owner"
	postgresOwnerUser     = "substrate_owner_user"
	postgresReadWriteRole = "substrate_readwrite"
	postgresReadWriteUser = "substrate_readwrite_user"
	postgresHost          = "postgres.ate-system.svc:5432"
)

// The generated objects' names.
const (
	secretActorIDJWTPool   = "actor-id-jwt-pool"
	secretActorIDCAPool    = "actor-id-ca-pool"
	secretActorIDCACerts   = "actor-id-ca-certs"
	secretEgressMITMCAPool = "egress-mitm-ca-pool"
	secretServiceDNSCA     = "service-dns-ca-pool"
	secretPodIdentityCA    = "pod-identity-ca-pool"
	secretPostgresCA       = "postgres-ca-pool"
	secretAPIEnvVars       = "ate-api-server-secret-envvars"
	configMapAPIEnvVars    = "ate-api-server-envvars"
	configMapAPIAuthn      = "ate-api-authentication"
	configMapAPIConfig     = "ate-api-config"
	configMapOtel          = "ate-otel-config"
)

// inClusterIssuer is the API server's issuer when the cluster publishes no
// other; its discovery document is read with the pod's own token and CA.
const inClusterIssuer = "https://kubernetes.default.svc"

// pool is one piece of key material made once.
type pool struct {
	namespace, name string
	secretType      corev1.SecretType
	generate        func() (map[string][]byte, error)
}

func caPool(namespace, name string, kt keyType) pool {
	return pool{namespace: namespace, name: name, secretType: corev1.SecretTypeTLS, generate: func() (map[string][]byte, error) {
		return newCAPool(kt, time.Now())
	}}
}

func pools() []pool {
	return []pool{
		caPool(PodCertNamespace, secretServiceDNSCA, keyEd25519),
		caPool(PodCertNamespace, secretPodIdentityCA, keyEd25519),
		caPool(PodCertNamespace, secretPostgresCA, keyEd25519),
		caPool(Namespace, secretActorIDCAPool, keyECDSAP256),
		caPool(Namespace, secretEgressMITMCAPool, keyECDSAP256),
		{namespace: Namespace, name: secretActorIDJWTPool, secretType: corev1.SecretTypeOpaque, generate: newJWTPool},
	}
}

// keyMaterial is what the configuration derives from the pools.
type keyMaterial struct {
	actorIDRoot []byte
}

// ensureKeyMaterial creates each pool Secret that does not exist and reads
// back what the configuration derives from them.
func ensureKeyMaterial(ctx context.Context, cl Cluster) (keyMaterial, error) {
	var km keyMaterial
	for _, p := range pools() {
		var existing corev1.Secret
		err := cl.Reader.Get(ctx, client.ObjectKey{Namespace: p.namespace, Name: p.name}, &existing)
		if apierrors.IsNotFound(err) {
			data, gerr := p.generate()
			if gerr != nil {
				return km, fmt.Errorf("generating %s/%s: %w", p.namespace, p.name, gerr)
			}
			existing = corev1.Secret{
				ObjectMeta: metav1.ObjectMeta{Namespace: p.namespace, Name: p.name,
					Labels: map[string]string{render.ManagedByLabel: render.ManagedByValue}},
				Type: p.secretType,
				Data: data,
			}
			cerr := cl.Writer.Create(ctx, &existing)
			if apierrors.IsAlreadyExists(cerr) {
				// Another pass made it first; keep what it made.
				if gerr := cl.Reader.Get(ctx, client.ObjectKey{Namespace: p.namespace, Name: p.name}, &existing); gerr != nil {
					return km, fmt.Errorf("reading %s/%s: %w", p.namespace, p.name, gerr)
				}
			} else if cerr != nil {
				return km, fmt.Errorf("creating %s/%s: %w", p.namespace, p.name, cerr)
			}
		} else if err != nil {
			return km, fmt.Errorf("reading %s/%s: %w", p.namespace, p.name, err)
		}
		if p.name == secretActorIDCAPool {
			root, rerr := rootPEM(existing.Data["pool"])
			if rerr != nil {
				return km, fmt.Errorf("%s/%s: %w", p.namespace, p.name, rerr)
			}
			km.actorIDRoot = root
		}
	}
	return km, nil
}

// configs is the rendered configuration and the hash the API server
// restarts on.
type configs struct {
	objects []*unstructured.Unstructured
	envHash string
}

// configObjects renders the configuration objects from the settings.
func configObjects(r *release, s Settings, km keyMaterial, issuer string) (configs, error) {
	if issuer == "" {
		issuer = inClusterIssuer
	}
	authn, err := authenticationConfig(issuer)
	if err != nil {
		return configs{}, err
	}
	apiConfig := map[string]string{"apiconfig.textproto": "logging: {\n  level: \"info\"\n}\n"}
	authnData := map[string]string{"authentication.yaml": authn}
	envVars := map[string]string{
		"ATE_API_POSTGRES_READ_WRITE_ROLE":          postgresReadWriteRole,
		"ATE_API_POSTGRES_OWNER_ROLE":               postgresOwnerRole,
		"ATE_API_ACTOR_JWT_ISSUER":                  ActorJWTIssuer,
		"ATE_API_SNAPSHOT_TRANSFER_SERVICE_ACCOUNT": "",
		"ATE_API_SNAPSHOT_LOCATION":                 s.SnapshotLocation,
	}
	secretEnv := map[string]string{
		"ATE_API_POSTGRES_READ_WRITE_CONNECTION_STRING": postgresDSN(postgresReadWriteUser),
		"ATE_API_POSTGRES_OWNER_CONNECTION_STRING":      postgresDSN(postgresOwnerUser),
		"ATE_API_POSTGRES_SCHEMA":                       postgresSchema,
	}
	setup, err := fs.ReadFile(r.files, filePostgresSetup)
	if err != nil {
		return configs{}, fmt.Errorf("reading Agent Substrate's database setup: %w", err)
	}
	objs := []*unstructured.Unstructured{
		configMap(Namespace, configMapAPIConfig, apiConfig),
		configMap(Namespace, configMapAPIAuthn, authnData),
		configMap(Namespace, configMapAPIEnvVars, envVars),
		secret(Namespace, secretAPIEnvVars, secretEnv),
		secret(Namespace, secretActorIDCACerts, map[string]string{"ca.crt": string(km.actorIDRoot)}),
		secret(Namespace, SnapshotStoreSecret, map[string]string{
			snapshotStoreAccessKeyID:     s.SnapshotStore.AccessKeyID,
			snapshotStoreSecretAccessKey: s.SnapshotStore.SecretAccessKey,
		}),
		configMap(Namespace, configMapOtel, map[string]string{
			"OTEL_TRACES_EXPORTER":            "none",
			"OTEL_METRICS_EXPORTER":           "prometheus",
			"OTEL_LOGS_EXPORTER":              "console",
			"ATE_WORKER_OTEL_TRACES_EXPORTER": "none",
			"ATE_WORKER_OTEL_LOGS_EXPORTER":   "console",
		}),
		configMap(Namespace, postgresSetupConfigMap, map[string]string{"setup.sql": string(setup)}),
	}
	return configs{objects: objs, envHash: envHash(envVars, authnData, apiConfig, secretEnv)}, nil
}

// generatedName names one object this file renders or creates.
type generatedName struct{ kind, namespace, name string }

// generatedNames is every object this file renders or creates.
func generatedNames() []generatedName {
	var out []generatedName
	for _, p := range pools() {
		out = append(out, generatedName{"Secret", p.namespace, p.name})
	}
	for _, name := range []string{secretAPIEnvVars, secretActorIDCACerts, SnapshotStoreSecret} {
		out = append(out, generatedName{"Secret", Namespace, name})
	}
	for _, name := range []string{configMapAPIConfig, configMapAPIAuthn, configMapAPIEnvVars, configMapOtel, postgresSetupConfigMap} {
		out = append(out, generatedName{"ConfigMap", Namespace, name})
	}
	return out
}

// postgresDSN is one login user's connection to the bundled database: TLS
// verified against the service DNS trust bundle, authenticated by the
// user's own pod certificate.
func postgresDSN(user string) string {
	bundle := "/run/postgres.podcert.ate.dev/" + user + ".pem"
	return fmt.Sprintf("postgresql://%s@%s/atepg?sslmode=verify-full&sslrootcert=/run/servicedns.podcert.ate.dev/trust-bundle.pem&sslcert=%s&sslkey=%s",
		user, postgresHost, bundle, bundle)
}

type jwtProvider struct {
	Name                     string   `json:"name"`
	Issuer                   string   `json:"issuer"`
	Audiences                []string `json:"audiences"`
	CertificateAuthorityFile string   `json:"certificateAuthorityFile,omitempty"`
	DiscoveryTokenFile       string   `json:"discoveryTokenFile,omitempty"`
}

// authenticationConfig is the API server's one token provider: the cluster's
// service account tokens for its audience.
func authenticationConfig(issuer string) (string, error) {
	p := jwtProvider{Name: "kubernetes", Issuer: issuer, Audiences: []string{APIServerName}}
	if issuer == inClusterIssuer || issuer == inClusterIssuer+".cluster.local" {
		p.CertificateAuthorityFile = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
		p.DiscoveryTokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	}
	b, err := yaml.Marshal(map[string][]jwtProvider{"jwtProviders": {p}})
	if err != nil {
		return "", fmt.Errorf("encoding the API server's authentication: %w", err)
	}
	return string(b), nil
}

// envHash is a hash of the API server's settings, in the shape Substrate's
// installer hashes them.
func envHash(envVars, authn, apiConfig, secretEnv map[string]string) string {
	h := sha256.New()
	section := func(label string, m map[string]string) {
		fmt.Fprintf(h, "%s\n", label)
		for _, k := range slices.Sorted(maps.Keys(m)) {
			fmt.Fprintf(h, "%s=%s\n", k, m[k])
		}
	}
	section("configmap", envVars)
	section("authn", authn)
	section("apiconfig", apiConfig)
	section("secret", secretEnv)
	return hex.EncodeToString(h.Sum(nil))
}

func configMap(namespace, name string, data map[string]string) *unstructured.Unstructured {
	u := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{"namespace": namespace, "name": name},
	}}
	_ = unstructured.SetNestedStringMap(u.Object, data, "data")
	return u
}

func secret(namespace, name string, data map[string]string) *unstructured.Unstructured {
	encoded := make(map[string]string, len(data))
	for k, v := range data {
		encoded[k] = base64.StdEncoding.EncodeToString([]byte(v))
	}
	u := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
		"metadata": map[string]any{"namespace": namespace, "name": name},
	}}
	_ = unstructured.SetNestedStringMap(u.Object, encoded, "data")
	return u
}
