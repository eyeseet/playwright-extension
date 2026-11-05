const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

function fixture(exists=true) {
  const timers=[],groups=[],events=[];
  const event={addListener(){},removeListener(){}};
  const chrome={tabs:{get:async id=>{if(!exists)throw Error('removed');return{id};},group:async args=>{groups.push(args);await Promise.resolve();return args.groupId??100;},onUpdated:event,onRemoved:event},tabGroups:{update:async()=>{}}};
  const context=vm.createContext({chrome,console:{log(){}},WebSocket:{OPEN:1},setTimeout:fn=>{timers.push(fn);}});
  const sources=['relayConnection.ts','connectedTabGroup.ts'].map(name=>stripTypeScriptTypes(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),{mode:'transform'}).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,''));
  vm.runInContext(sources.join('\n')+'\nglobalThis.classes={RelayConnection,ConnectedTabGroup};',context);
  const relay=Object.create(context.classes.RelayConnection.prototype);
  Object.assign(relay,{_closed:false,_attachedTabs:new Set([1]),_pendingReattach:new Set(),_recoveryAttempts:new Map(),_hasEverAttached:true,_sendMessage:message=>events.push(message),attachTab(){},close(){this.closed=true;}});
  return {classes:context.classes,relay,timers,groups,events};
}

test('simultaneous tab attachments create one group and ignore duplicate grouping',async()=>{
  const f=fixture();const group=Object.create(f.classes.ConnectedTabGroup.prototype);
  Object.assign(group,{_groupId:null,_groupQueue:Promise.resolve(),_groupTabIds:new Set(),groupStyle:{title:'Test'},_connection:f.relay});
  await Promise.all([group._addTabToGroup(1),group._addTabToGroup(2),group._addTabToGroup(2)]);
  assert.equal(f.groups.length,2);assert.equal(f.groups.filter(g=>g.groupId===undefined).length,1);assert.equal(f.groups[1].groupId,100);
});

test('removed tabs are not grouped',async()=>{
  const f=fixture(false);const group=Object.create(f.classes.ConnectedTabGroup.prototype);
  Object.assign(group,{_groupQueue:Promise.resolve(),_connection:f.relay});await group._addTabToGroup(1);assert.equal(f.groups.length,0);
});

test('repeated target_closed preserves transport while recovery is pending',()=>{
  const f=fixture();f.relay._onChromeEvent('chrome.debugger.onDetach',[{tabId:1},'target_closed']);
  assert(f.relay._pendingReattach.has(1));assert(f.relay._maybeScheduleReattach(1));assert.equal(f.timers.length,1);assert.equal(f.relay.closed,undefined);
});

test('bounded failed recovery keeps an existing tab and reports exhaustion',async()=>{
  const f=fixture();f.relay._onChromeEvent('chrome.debugger.onDetach',[{tabId:1},'target_closed']);
  for(let i=0;f.timers.length&&i<20;i++){f.timers.shift()();await new Promise(setImmediate);}
  assert.equal(f.relay.closed,undefined);
  assert.equal(f.events.filter(e=>e.params?.[0]?.event==='reattach-attempt').length,3);
  assert(f.events.some(e=>e.params?.[0]?.event==='reattach-exhausted-tab-kept'));
});

test('confirmed removal of last controlled tab releases transport',async()=>{
  const f=fixture(false);f.relay._onChromeEvent('chrome.debugger.onDetach',[{tabId:1},'target_closed']);
  f.timers.shift()();await new Promise(setImmediate);assert.equal(f.relay.closed,true);
});

test('successful recovery clears pending bookkeeping',async()=>{
  const f=fixture();f.relay._onChromeEvent('chrome.debugger.onDetach',[{tabId:1},'target_closed']);
  f.timers.shift()();await new Promise(setImmediate);f.relay._notifyTabAttached(1);
  for(const timer of f.timers)timer();assert(f.relay.attachedTabs.has(1));assert.equal(f.relay._pendingReattach.size,0);assert.equal(f.relay.closed,undefined);
});
