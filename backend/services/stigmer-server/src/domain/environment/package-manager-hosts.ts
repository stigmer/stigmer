/**
 * The hosts `allow_package_managers` opens, each with how it is reached.
 *
 * Claude Managed Agents' published list (platform.claude.com, "Package
 * manager hosts", read 2026-10-18), plus Debian's archive, `deb.debian.org`:
 * the default sandbox image is Debian (bookworm), whose apt sources name
 * that host, so without it `apt` packages could not install under limited
 * networking. The apt archives are listed for plain HTTP on port 80 as well
 * as HTTPS, because Debian and Ubuntu both ship their sources as http://
 * (their packages are signed), and Substrate's gateway passes plain HTTP
 * only to a host named for it.
 */

/** One package-manager host and the lanes it is reached on. */
export interface PackageManagerHost {
  readonly host: string;
  /** Plain HTTP on port 80 too, besides HTTPS. */
  readonly cleartext: boolean;
}

const https = (host: string): PackageManagerHost => ({ host, cleartext: false });
const archive = (host: string): PackageManagerHost => ({ host, cleartext: true });

export const PACKAGE_MANAGER_HOSTS: readonly PackageManagerHost[] = [
  // Code hosting
  https("github.com"),
  https("api.github.com"),
  https("codeload.github.com"),
  https("raw.githubusercontent.com"),
  https("objects.githubusercontent.com"),
  https("release-assets.githubusercontent.com"),
  https("gitlab.com"),
  https("bitbucket.org"),
  // Node.js
  https("registry.npmjs.org"),
  https("registry.yarnpkg.com"),
  https("nodejs.org"),
  // Python
  https("pypi.org"),
  https("files.pythonhosted.org"),
  // Rust
  https("crates.io"),
  https("index.crates.io"),
  https("static.crates.io"),
  https("static.rust-lang.org"),
  // Go
  https("proxy.golang.org"),
  https("sum.golang.org"),
  // Java
  https("repo1.maven.org"),
  https("repo.maven.apache.org"),
  https("services.gradle.org"),
  https("plugins.gradle.org"),
  https("plugins-artifacts.gradle.org"),
  // Ruby
  https("rubygems.org"),
  https("index.rubygems.org"),
  // PHP
  https("packagist.org"),
  https("repo.packagist.org"),
  // Debian and Ubuntu (apt)
  archive("deb.debian.org"),
  archive("archive.ubuntu.com"),
  archive("security.ubuntu.com"),
  archive("ppa.launchpad.net"),
  // Containers
  https("registry-1.docker.io"),
  https("auth.docker.io"),
  https("production.cloudflare.docker.com"),
  https("download.docker.com"),
  https("ghcr.io"),
];

/** The apt archives alone: what an Environment with apt packages needs over plain HTTP in every networking mode. */
export const APT_ARCHIVE_HOSTS: readonly string[] = PACKAGE_MANAGER_HOSTS.filter((h) => h.cleartext).map((h) => h.host);
