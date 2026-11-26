# Playwright extension maintenance fork

This is a public fork of [microsoft/playwright](https://github.com/microsoft/playwright), not an official Microsoft release. The extension lives in `packages/extension`, inside the full Playwright repository. Its Apache-2.0 license and notices are retained.

## Baseline and branches

- Baseline: upstream commit `81f985211281bf435a112eaf6532293d3c7523fb`, extension **0.6.0**.
- main is the maintained branch for this fork. Use the commit pinned by the Windows server release when building for deployment.

The fork follows the upstream 0.6.0 extension and uses its connection, tab ownership and group management code.

## Windows relay compatibility

- A background connection keeps its connect page so the Windows relay can use the private window helper. New tabs open inactive in the same window.
- The Windows relay can keep its VPS groups when a connection drops. Other background connections release a verified group and keep its tabs open.
- When the relay closes the last tabs of a verified group, the extension ungroups them first. A renamed or shared group is protected.
- When Chrome detaches the debugger from a tab that still exists, the extension makes up to three attempts to announce it again. The diagnostic events include only the event name, tab ID and attempt number.
- Existing scripts can still open `status.html` to reach the client management page.

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
