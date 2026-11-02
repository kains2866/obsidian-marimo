# Security

Connecting a notebook executes Python with the current user's permissions. A virtual environment is not a sandbox. Only connect to trusted notebooks and keep the service bound to loopback with authentication enabled.

Optional AI requests send notebook context to the configured provider. API keys are stored as plaintext in the plugin's vault-local `data.json`, which sync tools may copy. Recovery drafts contain code and live outside the vault. See the README for these disclosures.

For security-sensitive reports, contact the maintainer through the [GitHub profile](https://github.com/kains2866) to arrange a private reporting channel before sharing an exploit or private data. Do not post credentials, service tokens, personal notebooks or exploit payloads in public issues. No response-time guarantee is provided.

The currently supported adapter targets marimo 0.25.2. Updating it requires protocol and host verification; an upstream version change is not automatically supported. Dependency audit results are point-in-time checks, not a guarantee that no vulnerabilities exist.
