# Local deployment and server integration

`extension-repaired` is an installed build, not a separate Git checkout. Keep the Git history and TypeScript sources in this fork. `Build-InstallExtension.ps1` tests, builds, copies and verifies the extension, then records the source commit, dirty state, source folder and version in `fork-build.json`. Chrome must reload the unpacked extension after installation. The script does not restart Chrome or change tokens.

Install the build dependencies with the upstream `npm ci` in a full checkout. On Windows run:

```powershell
.\maintenance\Build-InstallExtension.ps1
```

The default installation root is the current user's Documents/PlaywrightMCP folder. Use `-InstallRoot` to select another existing installation. These operations are manual deployment, not an automatic updater. A build from a dirty source tree is explicitly marked in its metadata.

The `windows-server` folder contains the local relay's window-routing and group-management modules. These supplement the existing Windows installation, not the stock upstream MCP server. They contain no credentials, tunnel configuration, browser data or logs. The existing Supervisor and other compatibility patches remain necessary.

The dedicated-window behavior also needs this hook in the installed MCP runtime's `_openConnectPageInBrowser`, immediately before `args.push(href)`:

```javascript
if (String(clientName).startsWith('Playwright Window Router'))
  args.push('--new-window');
```

It bootstraps the private helper in a new Chrome window. The router always targets that helper's window. The first window creation can bring Chrome forward; subsequent background connections do not request window focus. Never launch every work connection with `--new-window`.

The extension must additionally pass `createProperties.windowId` when creating a group. Without it Chrome can move correctly routed tabs to the currently active window.

Welcome-only chat groups expire after five minutes without chat browser activity. The private helper remains as the stable window anchor. Website groups require explicit finish/handoff and are not deleted merely because they are idle. A separate conservative sweep handles untracked Welcome-only chat pages left by a restart; it never adopts or deletes website tabs.

## Chrome tab-group cleanup

When Playwright closes the remaining tabs of its own group, the extension ungroups them before closing them. This prevents Chrome from keeping a saved copy. Closing one of several tabs leaves the group in place. On a relay disconnect, the extension ungroups the group it created and leaves the tabs open. Cleanup checks the live group ID, exact title, membership and shared status. A restarted service worker leaves existing groups in place because it has lost its in-memory ownership records.

On the Windows relay, use `browser_session_finish` to finish the current conversation. Use `keepTabs: true` to leave website tabs open. Chrome can retain saved groups if a user closes an entire group or window directly, or if Chrome exits before Playwright can ungroup it.

Chrome's [tabGroups API](https://developer.chrome.com/docs/extensions/reference/api/tabGroups) works with open groups and session-scoped IDs. Its [sessions API](https://developer.chrome.com/docs/extensions/reference/api/sessions) exposes recent tabs and windows. Neither provides enumeration or deletion of closed saved groups. Chromium [deletes those groups internally](https://chromium.googlesource.com/chromium/src/+/815c5cff075fb58c5ec93d967479af57312a5894/chrome/browser/ui/tabs/saved_tab_groups/saved_tab_group_utils.cc) by saved UUID. A native messaging host would still need a supported way to access that operation and establish ownership. A title prefix can also belong to a user-created group. Review legacy entries in Chrome's Tab groups menu and delete only individually identified groups there. No MCP bulk deletion tool is available for these legacy entries.
