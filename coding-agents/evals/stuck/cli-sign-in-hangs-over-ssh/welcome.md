What a good answer may also say. Never graded: leaving any of it out fails nothing.

- The local ports are 17234 to 17236.
- The CLI picks the code by itself where no browser can open, when the provider offers it.
- On a self-hosted server the code works only when its sign-in provider allows the device grant; without it the CLI says so, and a browser or an API key is the way in.
- `stigmer auth whoami` confirms the sign-in.
- For CI and scripts an API key is the way in rather than a sign-in.
