# Community plugin release preparation

**Goal:** Publish the existing source to `kains2866/obsidian-marimo-notebook` and prepare reproducible Obsidian release assets without publishing a release or submitting a directory application in this task.

**Approved decisions:** MIT; keep version `0.0.1`, ID `marimo-notebook`, name `MarimoNotebook`, desktop only; bundle chart renderers; default new installations to manual connection while preserving an explicit existing auto-connect preference.

## Tasks

- [x] Capture the clean baseline and verify identity availability against the official community registry.
- [x] Add behavior tests for opt-in automatic execution and locally supplied chart renderers; observe failure before implementing.
- [x] Replace the shared `node_modules` symlink with an independent installation, a committed lockfile, pinned rendering dependencies, and required third-party notices. Do not modify the Jupyter project.
- [x] Replace CDN script injection with bundled lazy imports and retain readable rendering errors.
- [x] Add a release preflight validating manifest/package/versions/README identity, desktop declaration, distributable contents and bundled imports; test its failure modes.
- [x] Produce only `main.js`, `manifest.json`, and `styles.css` as release assets. An optional local manual-install ZIP contains the plugin folder and is never uploaded by the release workflow. Do not recursively delete user release folders.
- [x] Add CI, tag-validated draft release automation, version management, MIT license, English/Chinese README, disclosures, contribution/security guidance, and submission copy/instructions.
- [x] Verify a clean install/build, all relevant tests, typecheck, release validation, local ZIP layout and Temp installation. Record actual checks separately from unperformed Windows/Linux GUI checks.
- [x] Review changes and create the public repository. The final commit/push and remote CI results are checked after this plan is committed; see GitHub Actions for the authoritative run status. Do not tag, publish a release, or submit a directory entry.

## Required public documentation

Explain local Python execution and explicit trust, the pinned marimo `0.25.2` / Python `3.12` environment, desktop-only behavior, native frontend boundaries, supported and unsupported widgets, browser fallback, local recovery storage outside the vault, and optional AI requests including code/variable context and plaintext vault settings. No exclusivity, full parity, accepted-directory, or untested cross-platform claims.

## Primary references checked on 2026-11-02

- https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin
- https://docs.obsidian.md/Reference/Manifest
- https://docs.obsidian.md/Reference/Versions
- https://docs.obsidian.md/community-directory/developer-policies
- https://docs.obsidian.md/community-directory/submission-requirements-for-plugins

The repository root manifest is used for directory review. A matching version tag and release with individual assets is additionally needed before users can install from the directory. That later publication is not part of this task.

## 后续更名

用户确认新名称 **Marimo Native**、ID `marimo-native`，原 ID 与已归档商店条目冲突。GitHub 仓库已由用户更名为 `kains2866/obsidian-marimo`；以当前 manifest 与提交材料为准。本文前面的名称为最初准备阶段的历史记录。
