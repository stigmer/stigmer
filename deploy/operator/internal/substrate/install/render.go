// Agent Substrate's install files, read from the release the operator embeds
// and changed only where this install's shape and settings require.
//
// The files are upstream's, unmodified (make vendor-substrate). Each change
// below is its own function, named for what it does, and each finds its
// anchor by object kind, object name and container name. A re-vendored
// release that moves an anchor fails these functions with the file and
// object named, so the unit tests catch it before a cluster does. The changes
// are the ones Substrate's own installer makes for this shape:
//
//   - every image pinned by digest, from the release's pin table;
//   - the API server's bootstrap owners, the router's allowed SPIFFE IDs and
//     the identity server's issuer, which the files leave to the installer;
//   - the snapshot store: S3 settings on both object-store sidecars, the
//     credentials by reference to a Secret in ate-system;
//   - what only Google's cloud has, removed by name: atelet's image
//     credential-provider flags and host paths, and the compute-class
//     toleration;
//   - the bundled Postgres claim, sized for metadata (the bucket holds the
//     snapshots), and its roles made by the Postgres pod itself on start;
//   - on a development cluster, the in-cluster address of the local registry
//     atelet pulls loopback image references through.
//
// Only one shape is supported: bundled Postgres, gVisor and the Envoy
// dataplane. Substrate's microVM class, its other dataplane, Cloud SQL and
// its credential providers are never rendered.

package install

import (
	"bytes"
	"fmt"
	"io/fs"
	"slices"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"sigs.k8s.io/yaml"

	"github.com/stigmer/stigmer/deploy/operator/internal/helmrender"
	"github.com/stigmer/stigmer/deploy/operator/internal/manifests"
)

// The release's files, by the phase that applies them.
const (
	fileNamespace          = "ate-system-namespace.yaml"
	fileSandboxValidation  = "sandboxconfig-validation.yaml"
	fileSandboxGVisor      = "sandboxconfig-gvisor.yaml"
	filePodCertController  = "pod-certificate-controller.yaml"
	filePostgres           = "postgres.yaml"
	filePostgresSetup      = "postgres-setup.sql"
	fileAPIServer          = "ate-api-server.yaml"
	fileIDPServer          = "ate-idp-server.yaml"
	fileController         = "ate-controller.yaml"
	fileAtelet             = "atelet.yaml"
	fileRouter             = "atenet-router.yaml"
	fileEgress             = "atenet-egress.yaml"
	fileNetworkPolicies    = "ate-system-networkpolicies.yaml"
	fileImages             = "images.yaml"
	generatedDir           = "generated"
	koPrefix               = "ko://go.ate.dev/substrate/cmd/"
	envoyImagePlaceholder  = "${ENVOY_DATAPLANE_IMAGE}"
	envoyImage             = "envoy-dataplane"
	workerImage            = "ateworker-gvisor"
	postgresClaim          = "10Gi"
	postgresSetupConfigMap = "postgres-setup"
	postgresSetupMount     = "/etc/postgresql-setup"
)

// release is the embedded release: its files and image pins.
type release struct {
	files   fs.FS
	version string
	images  map[string]string
}

type pinTable struct {
	Version string            `json:"version"`
	Images  map[string]string `json:"images"`
}

// loadRelease reads the pin table of the release in files.
func loadRelease(files fs.FS) (*release, error) {
	raw, err := fs.ReadFile(files, fileImages)
	if err != nil {
		return nil, fmt.Errorf("reading Agent Substrate's image pins: %w", err)
	}
	var pins pinTable
	if err := yaml.Unmarshal(raw, &pins); err != nil {
		return nil, fmt.Errorf("reading Agent Substrate's image pins: %w", err)
	}
	if pins.Version == "" || len(pins.Images) == 0 {
		return nil, fmt.Errorf("Agent Substrate's image pins name no version or images: run make vendor-substrate")
	}
	return &release{files: files, version: pins.Version, images: pins.Images}, nil
}

// embedded is the release the operator carries.
func embedded() (*release, error) { return loadRelease(manifests.SubstrateRelease()) }

// image is a pinned image by its name under Substrate's registry.
func (r *release) image(name string) (string, error) {
	ref, ok := r.images[name]
	if !ok {
		return "", fmt.Errorf("Agent Substrate %s has no pinned image %q", r.version, name)
	}
	return ref, nil
}

// objects reads one file with every image pinned.
func (r *release) objects(file string) ([]*unstructured.Unstructured, error) {
	raw, err := fs.ReadFile(r.files, file)
	if err != nil {
		return nil, fmt.Errorf("reading Agent Substrate's %s: %w", file, err)
	}
	raw, err = r.pinImages(file, raw)
	if err != nil {
		return nil, err
	}
	objs, err := helmrender.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parsing Agent Substrate's %s: %w", file, err)
	}
	return objs, nil
}

// generated reads the release's definitions and the controller's roles.
func (r *release) generated() ([]*unstructured.Unstructured, error) {
	entries, err := fs.ReadDir(r.files, generatedDir)
	if err != nil {
		return nil, fmt.Errorf("reading Agent Substrate's definitions: %w", err)
	}
	var out []*unstructured.Unstructured
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".yaml") {
			continue
		}
		objs, err := r.objects(generatedDir + "/" + e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, objs...)
	}
	return out, nil
}

// pinImages replaces every ko:// reference and the Envoy placeholder with
// the release's pinned image, refusing a reference with no pin.
func (r *release) pinImages(file string, raw []byte) ([]byte, error) {
	if bytes.Contains(raw, []byte(envoyImagePlaceholder)) {
		ref, err := r.image(envoyImage)
		if err != nil {
			return nil, err
		}
		raw = bytes.ReplaceAll(raw, []byte(envoyImagePlaceholder), []byte(ref))
	}
	for {
		i := bytes.Index(raw, []byte(koPrefix))
		if i < 0 {
			return raw, nil
		}
		end := i + len(koPrefix)
		for end < len(raw) && !bytes.ContainsAny(raw[end:end+1], " \t\r\n\"'") {
			end++
		}
		name := string(raw[i+len(koPrefix) : end])
		ref, err := r.image(name)
		if err != nil {
			return nil, fmt.Errorf("%s names %s%s: %w", file, koPrefix, name, err)
		}
		raw = append(raw[:i:i], append([]byte(ref), raw[end:]...)...)
	}
}

// find is the one object of a kind and name.
func find(objs []*unstructured.Unstructured, kind, name string) (*unstructured.Unstructured, error) {
	for _, u := range objs {
		if u.GetKind() == kind && u.GetName() == name {
			return u, nil
		}
	}
	return nil, fmt.Errorf("Agent Substrate's release has no %s %s", kind, name)
}

// container edits one container of a workload's pod template in place.
// initContainer says which list it is in.
func container(u *unstructured.Unstructured, name string, initContainer bool, edit func(c map[string]any) error) error {
	field := "containers"
	if initContainer {
		field = "initContainers"
	}
	list, found, err := unstructured.NestedSlice(u.Object, "spec", "template", "spec", field)
	if err != nil || !found {
		return fmt.Errorf("%s %s has no %s", u.GetKind(), u.GetName(), field)
	}
	for i, item := range list {
		c, ok := item.(map[string]any)
		if !ok || c["name"] != name {
			continue
		}
		if err := edit(c); err != nil {
			return fmt.Errorf("%s %s, container %s: %w", u.GetKind(), u.GetName(), name, err)
		}
		list[i] = c
		return unstructured.SetNestedSlice(u.Object, list, "spec", "template", "spec", field)
	}
	return fmt.Errorf("%s %s has no container %s", u.GetKind(), u.GetName(), name)
}

// setFlag replaces every occurrence of a flag in a container's args with one
// --flag=value, or removes it when value is empty.
func setFlag(c map[string]any, flag, value string) error {
	args, _, err := unstructured.NestedStringSlice(c, "args")
	if err != nil {
		return err
	}
	args = slices.DeleteFunc(args, func(a string) bool { return a == flag || strings.HasPrefix(a, flag+"=") })
	if value != "" {
		args = append(args, flag+"="+value)
	}
	return unstructured.SetNestedStringSlice(c, args, "args")
}

// dropFlag removes a flag the release must carry, refusing when it does not.
func dropFlag(c map[string]any, flag string) error {
	args, _, err := unstructured.NestedStringSlice(c, "args")
	if err != nil {
		return err
	}
	kept := slices.DeleteFunc(slices.Clone(args), func(a string) bool { return a == flag || strings.HasPrefix(a, flag+"=") })
	if len(kept) == len(args) {
		return fmt.Errorf("has no %s flag to remove", flag)
	}
	return unstructured.SetNestedStringSlice(c, kept, "args")
}

// envVar is one container environment entry, as unstructured.
type envVar = map[string]any

func plainEnv(name, value string) envVar { return envVar{"name": name, "value": value} }

func secretEnv(name, secret, key string) envVar {
	return envVar{"name": name, "valueFrom": map[string]any{"secretKeyRef": map[string]any{"name": secret, "key": key}}}
}

// setEnv sets each variable on a container, replacing one of the same name.
func setEnv(c map[string]any, vars ...envVar) error {
	list, _, err := unstructured.NestedSlice(c, "env")
	if err != nil {
		return err
	}
	for _, v := range vars {
		list = slices.DeleteFunc(list, func(item any) bool {
			m, ok := item.(map[string]any)
			return ok && m["name"] == v["name"]
		})
		list = append(list, v)
	}
	return unstructured.SetNestedSlice(c, list, "env")
}

// dropNamed removes the entries of a list under path whose key field equals
// value, refusing when there is none.
func dropNamed(obj map[string]any, key, value string, path ...string) error {
	list, found, err := unstructured.NestedSlice(obj, path...)
	if err != nil || !found {
		return fmt.Errorf("has no %s", strings.Join(path, "."))
	}
	kept := slices.DeleteFunc(slices.Clone(list), func(item any) bool {
		m, ok := item.(map[string]any)
		return ok && m[key] == value
	})
	if len(kept) == len(list) {
		return fmt.Errorf("has no %s with %s %s", strings.Join(path, "."), key, value)
	}
	return unstructured.SetNestedSlice(obj, kept, path...)
}

// snapshotStoreEnv is the S3 settings an object-store sidecar reads.
func snapshotStoreEnv(s ObjectStore) []envVar {
	vars := []envVar{
		plainEnv("ATE_STORAGE_BACKEND", "s3"),
		plainEnv("AWS_REGION", s.Region),
		plainEnv("AWS_S3_USE_PATH_STYLE", fmt.Sprint(s.PathStyle)),
		secretEnv("AWS_ACCESS_KEY_ID", SnapshotStoreSecret, snapshotStoreAccessKeyID),
		secretEnv("AWS_SECRET_ACCESS_KEY", SnapshotStoreSecret, snapshotStoreSecretAccessKey),
	}
	if s.Endpoint != "" {
		vars = append(vars, plainEnv("AWS_ENDPOINT_URL", s.Endpoint))
	}
	return vars
}

// patchAPIServer sets the bootstrap owners, the snapshot store and the hash
// of the API server's settings, whose change restarts it.
func patchAPIServer(objs []*unstructured.Unstructured, s Settings, envHash string) error {
	dep, err := find(objs, "Deployment", "ate-api-server")
	if err != nil {
		return err
	}
	if err := container(dep, "ate-api-server", false, func(c map[string]any) error {
		return setFlag(c, "--authz-bootstrap-owners", strings.Join(s.BootstrapOwners, ","))
	}); err != nil {
		return err
	}
	if err := container(dep, "objectstore-plugin", true, func(c map[string]any) error {
		return setEnv(c, snapshotStoreEnv(s.SnapshotStore)...)
	}); err != nil {
		return err
	}
	return unstructured.SetNestedField(dep.Object, envHash, "spec", "template", "metadata", "annotations", envHashAnnotation)
}

// patchIDPServer names the issuer actors' tokens carry.
func patchIDPServer(objs []*unstructured.Unstructured) error {
	dep, err := find(objs, "Deployment", "ate-idp-server")
	if err != nil {
		return err
	}
	return container(dep, "ate-idp-server", false, func(c map[string]any) error {
		return setFlag(c, "--issuer", ActorJWTIssuer)
	})
}

// patchRouter admits the clients whose SPIFFE IDs are allowed.
func patchRouter(objs []*unstructured.Unstructured, s Settings) error {
	dep, err := find(objs, "Deployment", "atenet-router")
	if err != nil {
		return err
	}
	return container(dep, "atenet-router", false, func(c map[string]any) error {
		return setFlag(c, "--ingress-allowed-spiffe-ids", strings.Join(s.IngressAllowedSPIFFEIDs, ","))
	})
}

// patchAtelet points atelet's sidecar at the snapshot store, removes what
// only Google's cloud has, and passes a development cluster's registry.
func patchAtelet(objs []*unstructured.Unstructured, s Settings) error {
	ds, err := find(objs, "DaemonSet", "atelet")
	if err != nil {
		return err
	}
	if err := container(ds, "objectstore-plugin", true, func(c map[string]any) error {
		return setEnv(c, snapshotStoreEnv(s.SnapshotStore)...)
	}); err != nil {
		return err
	}
	if err := container(ds, "atelet", false, func(c map[string]any) error {
		for _, flag := range []string{"--image-credential-provider-config", "--image-credential-provider-bin-dir"} {
			if err := dropFlag(c, flag); err != nil {
				return err
			}
		}
		for _, path := range []string{"/run/image-credential-provider/bin", "/run/image-credential-provider/config.yaml"} {
			if err := dropNamed(c, "mountPath", path, "volumeMounts"); err != nil {
				return err
			}
		}
		return setFlag(c, "--localhost-registry-replacement", s.LocalhostRegistryReplacement)
	}); err != nil {
		return err
	}
	spec := ds.Object["spec"].(map[string]any)["template"].(map[string]any)["spec"].(map[string]any)
	for _, name := range []string{"image-credential-provider-bin", "image-credential-provider-config"} {
		if err := dropNamed(spec, "name", name, "volumes"); err != nil {
			return fmt.Errorf("DaemonSet atelet: %w", err)
		}
	}
	if err := dropNamed(spec, "key", "cloud.google.com/compute-class", "tolerations"); err != nil {
		return fmt.Errorf("DaemonSet atelet: %w", err)
	}
	return nil
}

// patchPostgres sizes the claim and has the Postgres pod make Substrate's
// roles and schema itself once it accepts connections, with upstream's
// idempotent setup script, so the operator never execs into it.
func patchPostgres(objs []*unstructured.Unstructured) error {
	sts, err := find(objs, "StatefulSet", "postgres")
	if err != nil {
		return err
	}
	claims, found, err := unstructured.NestedSlice(sts.Object, "spec", "volumeClaimTemplates")
	if err != nil || !found || len(claims) != 1 {
		return fmt.Errorf("StatefulSet postgres has no single volume claim")
	}
	claim := claims[0].(map[string]any)
	if err := unstructured.SetNestedField(claim, postgresClaim, "spec", "resources", "requests", "storage"); err != nil {
		return err
	}
	claims[0] = claim
	if err := unstructured.SetNestedSlice(sts.Object, claims, "spec", "volumeClaimTemplates"); err != nil {
		return err
	}
	if err := container(sts, "postgres", false, func(c map[string]any) error {
		cmd, found, err := unstructured.NestedStringSlice(c, "lifecycle", "postStart", "exec", "command")
		if err != nil || !found || len(cmd) != 3 || !strings.Contains(cmd[2], "createdb") {
			return fmt.Errorf("has no postStart hook creating the database")
		}
		cmd[2] = strings.TrimRight(cmd[2], "\n") + "\n" + postgresSetupCommand() + "\n"
		if err := unstructured.SetNestedStringSlice(c, cmd, "lifecycle", "postStart", "exec", "command"); err != nil {
			return err
		}
		mounts, _, err := unstructured.NestedSlice(c, "volumeMounts")
		if err != nil {
			return err
		}
		mounts = append(mounts, map[string]any{"name": postgresSetupConfigMap, "mountPath": postgresSetupMount, "readOnly": true})
		return unstructured.SetNestedSlice(c, mounts, "volumeMounts")
	}); err != nil {
		return err
	}
	volumes, _, err := unstructured.NestedSlice(sts.Object, "spec", "template", "spec", "volumes")
	if err != nil {
		return err
	}
	volumes = append(volumes, map[string]any{"name": postgresSetupConfigMap, "configMap": map[string]any{"name": postgresSetupConfigMap}})
	return unstructured.SetNestedSlice(sts.Object, volumes, "spec", "template", "spec", "volumes")
}

// postgresSetupCommand runs upstream's setup script over the pod's own
// socket, with the variables Substrate's installer passes: its schema, its
// two roles and their certificate-only login users.
func postgresSetupCommand() string {
	vars := []string{
		"substrate_schema=" + postgresSchema,
		"substrate_owner_role=" + postgresOwnerRole,
		"substrate_owner_user=" + postgresOwnerUser,
		"substrate_owner_password=",
		"substrate_readwrite_role=" + postgresReadWriteRole,
		"substrate_readwrite_user=" + postgresReadWriteUser,
		"substrate_readwrite_password=",
	}
	var b strings.Builder
	b.WriteString(`psql --no-psqlrc --set=ON_ERROR_STOP=1 --single-transaction -U "${POSTGRES_USER}" -d atepg`)
	for _, v := range vars {
		b.WriteString(" --set=" + v)
	}
	b.WriteString(" -f " + postgresSetupMount + "/setup.sql")
	return b.String()
}
