# Vendored notices

Some npm entry points contain dependencies that are already bundled upstream, so esbuild cannot discover their package boundaries. These notices are included explicitly in `THIRD_PARTY_NOTICES.md` and the built `main.js`.

- `vega-embed-7.3.0-fast-deep-equal.txt`: copied verbatim from the MIT comment in `vega-embed@7.3.0/build/embed.js` (comment markers removed).
- `vega-embed-7.3.0-fast-json-patch.txt`: full `fast-json-patch@3.1.1/LICENSE.txt`, used by the prebundled embed entry point.
- `plotly-2.32.0-NOTICES.txt`: official distribution notice from <https://cdn.plot.ly/plotly-2.32.0.min.js.LICENSE.txt>. Plotly's own full MIT license is additionally collected from its package.

- `plotly-2.32.0-vendored-LICENSES.txt`: full license texts for components named in the official distribution notices, fetched from npm tarballs using Plotly v2.32.0 upstream lock versions where available. Includes the full ieee754 BSD license (Fair Oaks Labs), and standard MIT terms for native-promise-only as granted in its package README, with Kyle Simpson attribution. Nested-bundle MIT packages missing from the root lock are identified explicitly.

When upgrading these prebundled packages, recheck upstream vendored dependencies and licenses, update the version-locked notice mapping in `scripts/third-party-notices.mjs`, rebuild, then copy `build/third-party-notices.md` to the root notice file. Release preflight checks that the complete notice text is present in `main.js`; no extra Release asset is necessary.
