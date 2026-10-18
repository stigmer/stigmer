An Environment is a named sandbox setup: the packages installed in every
sandbox a conversation using it runs in (`apt`, `cargo`, `gem`, `go`, `npm`,
`pip`), and the websites it may reach (`networking`: `unrestricted`, or
`limited` to `allowed_hosts`, optionally with the package registries and the
agent's MCP servers). A conversation uses the Environment it names, else its
routine's, else its agent's default, else its organization's. It holds no
secret, variable or image, and only an organization's admins create one.

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Environment
metadata:
  name: Data science
  slug: data-science
spec:
  description: "pandas and poppler, GitHub and our API only"
  networking:
    type: limited
    allowed_hosts: [api.github.com, our-api.example.com]
    allow_package_managers: true
  packages:
    apt: [poppler-utils]
    pip: [pandas, sqlalchemy==2.0.30]
```
