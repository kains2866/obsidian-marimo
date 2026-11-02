# Contributing

Use Node.js 24+ and a dedicated Python 3.12 environment with `pip install -r requirements-dev.txt`. Run `npm ci` in this repository; dependencies are independent of other local plugins.

Before proposing a change, run `npm test`, `npm run typecheck`, the Python unittest suite, and `npm run build`. Release-file changes also require `npm run check:release -- --artifacts`. Python integration tests start local authenticated marimo processes and execute their own fixtures. Report real Obsidian host tests separately from unit tests.

Keep marimo's version-specific protocol in `python/backend.py`. Preserve standard `.py` notebook compatibility, explicit execution consent, loopback authentication, process ownership and safe handling of external file changes. Do not replace the native view with an embedded website. Read [project instructions](AGENTS.md) and [current design documents](docs/README.md).

For bug reports, include plugin/Obsidian/OS/Python/marimo versions, steps, expected behavior and a minimal notebook with no personal data. Redact API keys, service tokens and sensitive notebook outputs. Do not commit local `data.json`, `.env`, generated builds, screenshots or runtime logs.

This project uses the MIT license; bundled dependencies keep their respective licenses. Do not claim tests were run on platforms or host versions you did not actually use.
