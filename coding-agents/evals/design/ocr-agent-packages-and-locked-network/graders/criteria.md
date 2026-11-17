---
type: llm
---

PASS if the answer uses an Environment, in the docs' terms:
- An Environment (made by an Organization admin, in the console under **Library → Environments** or as a `kind: Environment` manifest applied with `stigmer apply -f`) lists the packages: tesseract as an `apt` package, `pdfplumber` as a `pip` package. They install before the first turn of every fresh sandbox.
- Its network is `networking.type: limited` with `allowed_hosts` listing `api.dockline.example`.
- Packages under limited networking need `allow_package_managers: true` (**Also allow package registries and code hosts**), or the server refuses the Environment; the answer says this also opens the package registries and code hosts, which security should know.
- It is made the Agent's default (`environment_ref` on the Agent, or the Agent's page), or named per conversation or routine.

Welcome but optional: an Agent whose MCP servers sit at other hosts needs those hosts listed or **Also allow this Agent's MCP servers**; a conversation keeps the Environment it started with; Run settings or `status.environment_source` show which Environment a conversation got; an Environment never holds secrets; Environments don't apply to a conversation on the person's own machine, and a server whose sandboxes can't enforce a list or install packages says so.

FAIL if it tells them to install the packages from the Agent's instructions or a Skill as the setup; invents fields or files the docs don't name (a Dockerfile, an `image`, a `setup_script`, `allowed_domains`, `egress`); says limited networking with packages works without `allow_package_managers`; or puts keys or environment variables in the Environment.
