# Playwright extension maintenance fork

This is a public fork of [microsoft/playwright](https://github.com/microsoft/playwright), not an official Microsoft release. The extension lives in `packages/extension`, inside the full Playwright repository. Its Apache-2.0 license and notices are retained.

## Baseline and branches

- Baseline: upstream commit `bac1f9f67e9cff2a8e7ecbac25d56ec3bb1d15c6`, extension **0.5.0**.
- main is the maintained branch for this fork. Use the commit pinned by the Windows server release when building for deployment.

The earlier local prototype was based on extension 0.4.0. This fork ports the remaining changes to 0.5.0 TypeScript sources instead of checking in patched JavaScript bundles. Version 0.5.0 already supports background connections; this fork preserves that support and also creates new tabs inactive on background connections.

## Changes

- Serialize tab-group creation so concurrent debugger attachments create one group.
- Ungroup a verified Playwright group before closing its final tabs. Preserve existing groups on service-worker startup. See [Chrome tab-group cleanup](maintenance/README.md#chrome-tab-group-cleanup) for the Windows relay and Chrome API limits.
- Stop repeated temporary debugger detaches from closing a connection merely because a short cooldown has elapsed.
- Try recovery at most three times. Confirm tab removal before closing an empty connection; when a living tab cannot be recovered, keep its transport and emit a diagnostic event. This avoids endless reconnects but does not guarantee the unrecovered tab is usable.
- Emit optional `extension.audit` events containing event names and numeric tab/group identifiers. No URLs, tokens, page contents or form values are sent in those events. The stock relay ignores these events; a compatible local relay may store them.

Local Windows supervisor scripts, tunnel settings, credentials, logs and browser-profile files are **not** part of this repository. The local relay's 24-hour log retention is configured separately. Stock upstream diagnostic logging is otherwise unchanged.

## Tests and build

Dependency-free regression tests (Node.js 24):

```sh
node --test packages/extension/fork-tests/repairs.test.cjs
```

These tests execute the actual TypeScript implementation after removing types, with mocked Chrome APIs. They cover the grouping race and detach recovery. They do not replace browser integration tests.

For a complete extension build, use a full checkout and the upstream toolchain:

```sh
npm ci
npm run build
npm run test-extension -- tab-grouping scheme-detach
```

See `AGENTS.md` for full contribution and validation requirements. Run the complete build and `npm run flint` before proposing a PR. No upstream PR has been opened by this fork setup.

The repository does not publish a prebuilt extension release. A build still needs validation before replacing an installed extension. Fork publication does not modify the running browser or its unpacked extension directory. The unchanged upstream public manifest key preserves the extension ID; no private signing key or authentication token is included.

## Incorporate upstream changes

```sh
git remote add upstream https://github.com/microsoft/playwright.git
git fetch upstream
git switch main
git merge upstream/main
node --test packages/extension/fork-tests/repairs.test.cjs
```

Resolve conflicts and run the build and browser checks before pushing main to origin. Drop a fork change once upstream fixes the same behavior. If upstream is already configured, skip the first command.
