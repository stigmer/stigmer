---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Uses an Environment that lists tesseract as an apt package and `pdfplumber` as a pip package, which install before the first turn of every fresh sandbox.
- Limits the Environment's network to `api.dockline.example`, for example `networking.type: limited` (**Limited to listed websites**) with it in `allowed_hosts`.
- Says packages under limited networking also need package registries allowed (for example `allow_package_managers: true`), and that this opens the package registries and code hosts too, which security should know.
- Makes it the Agent's default Environment, or names it per conversation or routine.

**FAIL if**

- It tells them to install the packages from the Agent's instructions or a Skill as the setup.
- It invents fields or files the docs don't name, such as a Dockerfile, an `image`, a `setup_script`, `allowed_domains` or `egress`.
- It says limited networking with packages works without `allow_package_managers`.
- It puts keys or environment variables in the Environment.

**Welcome**

- An Agent whose MCP servers sit at other hosts needs those hosts listed, or **Also allow this Agent's MCP servers**.
- A conversation keeps the Environment it started with.
- Run settings, or `status.environment_source`, show which Environment a conversation got.
- An Environment never holds secrets.
- Environments don't apply to a conversation on the person's own machine, and a server whose sandboxes can't enforce a list or install packages says so.
- An Organization admin makes the Environment in the console under **Library → Environments**, or as a `kind: Environment` manifest applied with `stigmer apply -f`.
- Without package registries allowed, the server refuses an Environment with packages and limited networking; the console's option is **Also allow package registries and code hosts**.
- The Agent's default is `environment_ref` on the Agent, or set on the Agent's page.
