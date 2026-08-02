package harness

import "github.com/testcontainers/testcontainers-go"

// Container images for every service the harness boots, in one place.
//
// All references are deliberately bare Docker Hub names. In CI the
// TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX environment variable rewrites every
// bare-Hub reference — including the testcontainers Ryuk reaper, which never
// appears in this repo's source — to the GHCR mirror under
// ghcr.io/stigmer/mirror/, taking Docker Hub's rate limits and outages off
// the CI critical path (issue #334). Local runs set no prefix and pull from
// Docker Hub as always.
//
// The mirror is populated by .github/workflows/mirror-test-images.yaml,
// which derives its image list from MirrorImages below — this file is the
// single source of truth; there is no separate manifest to keep in sync.
//
// Changing an image here (or bumping testcontainers-go, which moves the Ryuk
// version) means CI needs the new image in the mirror BEFORE the integration
// legs can pass: the sync workflow runs on merge to main, so on the PR itself
// trigger "Mirror Test Images" manually (workflow_dispatch) from the branch,
// then re-run the failed legs.
const (
	redisImage = "redis:7-alpine"

	// postgres:16-alpine matches the image the cloud repo's Testcontainers
	// suites pin (RecordsPostgresContainerSmokeTest and friends).
	postgresImage = "postgres:16-alpine"

	// Pinned to the release the previously-floating :latest resolved to when
	// the mirror was introduced. A floating tag would make the mirror capture
	// a moving target and let CI drift from local runs.
	minioImage = "minio/minio:RELEASE.2025-09-07T16-13-09Z"

	// Pinned to the production OpenBAO version — the same image
	// VaultClientOpenBaoTest (stigmer-cloud) locks to, so what boots here is
	// what runs in prod.
	openBaoImage = "openbao/openbao:2.4.4"

	openFGAImage = "openfga/openfga:v1.8.2"

	// Started only when INTEGRATION_TEST_OTEL is set (the CI core leg), but
	// mirrored unconditionally so enabling OTel never depends on Docker Hub.
	jaegerImage = "jaegertracing/all-in-one:1.76.0"
)

// MirrorImages returns every Docker Hub image an integration run can pull:
// the six harness services plus the Ryuk resource reaper that
// testcontainers-go starts implicitly. Ryuk's version comes from the library
// itself, so a testcontainers-go upgrade updates this list automatically.
//
// testcontainers-go must stay a direct dependency only of this module
// (test/integration); the sibling suite modules hold it as an indirect
// dependency at the same version. Pinning it independently in a sibling
// would let that suite's Ryuk version diverge from the mirrored one.
func MirrorImages() []string {
	return []string{
		redisImage,
		postgresImage,
		minioImage,
		openBaoImage,
		openFGAImage,
		jaegerImage,
		testcontainers.ReaperDefaultImage,
	}
}
