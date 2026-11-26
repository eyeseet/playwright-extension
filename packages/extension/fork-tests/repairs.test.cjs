
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

function fixture() {
  const events = [];
  const timers = [];
  const tabs = new Map([
    [1, { id: 1, url: 'https://example.com/', windowId: 42, groupId: -1 }],
    [2, { id: 2, url: 'https://example.com/', windowId: 42, groupId: -1 }],
    [3, { id: 3, url: 'https://example.com/', windowId: 53, groupId: 200 }],
  ]);
  const groups = new Map([[200, { id: 200, title: 'Unrelated group' }]]);
  const shared = { onUpdated: {}, onRemoved: {} };
  const chrome = {
    tabs: {
      ...shared,
      get: async id => {
        if (!tabs.has(id))
          throw new Error('Removed tab');
        return { ...tabs.get(id) };
      },
      query: async ({ groupId }) => [...tabs.values()].filter(tab => tab.groupId === groupId),
      group: async options => {
        events.push(['group', options.createProperties?.windowId, options.groupId]);
        const groupId = options.groupId ?? 100;
        if (!groups.has(groupId))
          groups.set(groupId, { id: groupId });
        for (const tabId of options.tabIds)
          tabs.get(tabId).groupId = groupId;
        return groupId;
      },
      ungroup: async ids => {
        events.push(['ungroup', ...ids]);
        for (const id of ids)
          tabs.get(id).groupId = -1;
      },
      create: async options => {
        events.push(['create', options.windowId, options.active]);
        return { id: 4 };
      },
      remove: async ids => {
        events.push(['remove', ...ids]);
        for (const id of ids)
          tabs.delete(id);
      },
    },
    tabGroups: {
      ...shared,
      get: async id => {
        if (!groups.has(id))
          throw new Error('Removed group');
        return { ...groups.get(id) };
      },
      update: async (id, options) => Object.assign(groups.get(id), options),
    },
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    debugger: { attach: async () => {}, detach: async () => {} },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
  };
  const context = vm.createContext({ chrome, setTimeout: callback => { timers.push(callback); } });
  const code = ['cdpPolicy.ts', 'clientSession.ts', 'ownedTab.ts', 'tabGroupManager.ts', 'tabPicker.ts'].map(name =>
    stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), { mode: 'transform' })
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
  vm.runInContext(code + '\nglobalThis.classes = { ClientSession, OwnedTab, TabGroupManager, TabPicker };', context);
  const { ClientSession, OwnedTab, TabGroupManager, TabPicker } = context.classes;
  const registry = {
    onTabClaimed: undefined,
    ownerOf: id => id === 1 || id === 2 ? session : undefined,
    ownedTab: id => id === 1 || id === 2 ? { session } : undefined,
    claim: () => {},
  };
  const groupManager = new TabGroupManager(registry, { add() {} });
  const channel = { sendEvent: (name, params) => events.push([name, params]) };
  const session = new ClientSession(channel, registry, groupManager, { clientName: 'Fork test', tabGroup: {}, background: true });
  groupManager.register(session);

  const claimBoth = () => Promise.all([1, 2].map(id => groupManager._moveIntoGroup({ ...tabs.get(id) }, session)));
  return { chrome, events, tabs, groups, session, channel, timers, groupManager, claimBoth, registry, OwnedTab, TabPicker };
}

test('simultaneous tabs form one group in their own window', async () => {
  const f = fixture();
  await f.claimBoth();
  assert.deepEqual(f.events.filter(event => event[0] === 'group'), [['group', 42, undefined], ['group', undefined, 100]]);
  assert.equal(f.tabs.get(2).groupId, 100);
  assert.equal(f.tabs.get(3).groupId, 200);
});

test('background relay uses its connect tab and creates inactive tabs in the same window', async () => {
  const f = fixture();
  const picker = new f.TabPicker(f.registry, f.groupManager);
  const [connectTab] = await picker.apply({}, f.session, 1);
  assert.equal(connectTab.id, 1);
  f.session.didInitialize(connectTab.windowId);
  await f.channel.onCommand('chrome.tabs.create', [{ url: 'https://example.com/', active: true }]);
  assert.deepEqual(f.events.at(-1), ['create', 42, false]);
});

test('closing the last relay tab ungroups it before removal', async () => {
  const f = fixture();
  await f.claimBoth();
  await Promise.all([1, 2].map(id => f.channel.onCommand('chrome.tabs.remove', [id])));
  assert.deepEqual(f.events.slice(-3), [['remove', 1], ['ungroup', 2], ['remove', 2]]);
  assert.deepEqual([...f.tabs.keys()], [3]);
});

test('the relay cannot close a tab in a renamed or shared group', async () => {
  for (const change of [group => { group.title = 'Renamed'; }, group => { group.shared = true; }]) {
    const f = fixture();
    await f.claimBoth();
    change(f.groups.get(100));
    await assert.rejects(f.channel.onCommand('chrome.tabs.remove', [1]), /outside this Playwright connection/);
    assert(f.tabs.has(1));
  }
});

test('background disconnect releases a verified group and preserves the tabs', async () => {
  const f = fixture();
  await f.claimBoth();
  await f.groupManager.orphan(f.session, [1, 2]);
  assert.deepEqual(f.events.at(-1), ['ungroup', 1, 2]);
  assert.deepEqual([...f.tabs.keys()], [1, 2, 3]);
});

test('disconnect preserves a VPS, renamed, shared or partially owned group', async () => {
  const changes = [
    f => { f.session.options.preserveGroupOnDisconnect = true; },
    f => { f.groups.get(100).title = 'Renamed'; },
    f => { f.groups.get(100).shared = true; },
    f => { f.tabs.get(3).groupId = 100; },
  ];
  for (const change of changes) {
    const f = fixture();
    await f.claimBoth();
    change(f);
    await f.groupManager.orphan(f.session, [1, 2]);
    assert(!f.events.some(event => event[0] === 'ungroup'));
    assert.equal(f.groups.get(100).color, 'green');
    assert.deepEqual([...f.tabs.keys()], [1, 2, 3]);
  }
});

test('debugger recovery is bounded and stops when a tab is removed or reattached', async () => {
  for (const transition of ['removed', 'reattached', 'no change']) {
    const f = fixture();
    const tab = new f.OwnedTab(f.tabs.get(1), f.session, false);
    tab.didDetachDebugger('target_closed');
    tab.didDetachDebugger('target_closed');
    assert.equal(f.timers.length, 1);
    if (transition === 'removed')
      f.tabs.delete(1);
    if (transition === 'reattached')
      await tab.attach('1.3');
    for (let index = 0; f.timers.length && index < 5; index++) {
      f.timers.shift()();
      await new Promise(setImmediate);
    }
    assert.equal(f.timers.length, 0);
    const attempts = f.events.filter(event => event[0] === 'extension.audit');
    assert.equal(attempts.length, transition === 'no change' ? 3 : 0);
  }
});
