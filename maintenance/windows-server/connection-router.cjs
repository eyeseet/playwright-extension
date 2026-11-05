// A private, local helper session opens connect pages in the selected window
// before Playwright attaches. No connected group is moved between windows.
const CONTROLLER = 'Playwright Window Router';
const EXTENSION = 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm';
const {createHash}=require('node:crypto');
async function asyncMaintenance(){
 document.title='MCP-vensterbeheer (blijft open)';
 const own=await chrome.tabs.getCurrent();const tabs=await chrome.tabs.query({});
 let removed=0;for(const t of tabs){if(t.id===own.id)continue;let u,c;try{u=new URL(t.url);c=JSON.parse(u.searchParams.get('client'));}catch{continue;}
 if(u.origin!==location.origin||u.pathname!=='/connect.html'||c?.name!=='Playwright Window Router')continue;
 if(t.groupId>=0&&tabs.some(x=>x.groupId===t.groupId&&x.id!==t.id))continue;
 await chrome.tabs.ungroup([t.id]);await chrome.tabs.remove(t.id);removed++;
 }return {removed,windowId:own.windowId};
}

async function openConnectionPage({ href, preferredWindowId }) {
  if (location.origin !== 'chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm') throw new Error('Helper extension page required');
  const own = await chrome.tabs.getCurrent();
  const [groups, windows] = await Promise.all([chrome.tabGroups.query({}), chrome.windows.getAll({ windowTypes: ['normal'] })]);
  const eligible = new Set(windows.filter(w => w.type === 'normal' && !w.incognito).map(w => w.id));
  // The helper was bootstrapped in a NEW dedicated window. It is the
  // stable anchor; neither user focus nor arbitrary old work groups choose it.
  const targetWindowId = own.windowId;
  if (!eligible.has(targetWindowId)) throw new Error('No normal browser window');
  const created = await chrome.tabs.create({ windowId: targetWindowId, url: href, active: false });
  return { targetWindowId, tabId: created.id, reason: 'dedicated-mcp-window' };
}

function createConnectionRouter({ requestMcp, audit, onConnectionOpened = () => {}, releaseMcp = async()=>{} }) {
  let controllerPromise, preferredWindowId;
  const openings=new Map();
  const retiredHelpers=[];
  let helperInfo,helperRecoveries=0,lastFailure=null;
  let queue = Promise.resolve();
  let nextId = 0;
  async function call(session, method, params, notification = false) {
    return requestMcp({ jsonrpc:'2.0', ...(!notification ? { id:'window-router-'+(++nextId) } : {}), method, ...(params ? {params} : {}) },session);
  }
  async function controller() {
    if (!controllerPromise) {
      controllerPromise = (async () => {
        const initialized = await call(null,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:CONTROLLER,version:'1.0'}});
        if (!initialized.session) throw new Error('Helper session unavailable');
        await call(initialized.session,'notifications/initialized',undefined,true);
        const tabs = await call(initialized.session,'tools/call',{name:'browser_tabs',arguments:{action:'list'}});
        if (tabs.result?.isError) throw new Error('Helper browser unavailable');
        const info=await call(initialized.session,'tools/call',{name:'browser_evaluate',arguments:{function:"async()=>{const tab=await chrome.tabs.getCurrent();return {tabId:tab.id};}"}});
        if(info.result?.isError)throw Error('Helper identity unavailable');
        const infoText=info.result.content.find(c=>c.type==='text')?.text??'';
        const ownInfo=JSON.parse(infoText.match(/^### Result\s*\n([\s\S]*?)(?=\n### |$)/)?.[1]??'{}');
        if(!Number.isInteger(ownInfo.tabId))throw Error('Invalid helper identity');
        helperInfo={session:initialized.session,tabId:ownInfo.tabId};
        await call(initialized.session,'tools/call',{name:'browser_evaluate',arguments:{function: asyncMaintenance.toString()}});
        if(retiredHelpers.length){
          const retiredIds=retiredHelpers.map(h=>h.tabId).filter(Number.isInteger);
          // Remove only known, retired helper connection pages. Never remove a
          // group that acquired website tabs or was repurposed by the user.
          const cleanupCode=`async()=>{const own=await chrome.tabs.getCurrent();const ids=${JSON.stringify(retiredIds)};const tabs=await chrome.tabs.query({});const old=tabs.filter(t=>ids.includes(t.id)&&t.id!==own.id);let removed=0;for(const tab of old){let u;try{u=new URL(tab.url);}catch{continue;}if(u.protocol!=='chrome-extension:'||u.hostname!=='mmlmfjhmonkocbjadbfplnigmagldckm'||u.pathname!=='/connect.html')continue;let client;try{client=JSON.parse(u.searchParams.get('client'));}catch{continue;}if(!client?.name?.startsWith('Playwright Window Router'))continue;if(tab.groupId>=0){const members=await chrome.tabs.query({groupId:tab.groupId});if(members.length!==1)continue;await chrome.tabs.ungroup([tab.id]);}await chrome.tabs.remove([tab.id]);removed++;}return {removed};}`;
          const cleanup=await call(initialized.session,'tools/call',{name:'browser_evaluate',arguments:{function:cleanupCode}});
          if(cleanup.result?.isError)throw Error('Retired helper cleanup unavailable');
          retiredHelpers.splice(0);
        }
        return initialized.session;
      })();
      controllerPromise.catch(() => { controllerPromise = undefined; });
    }
    return controllerPromise;
  }
  function invalidateHelper(reason){lastFailure=reason;helperRecoveries++;if(helperInfo){retiredHelpers.push(helperInfo);void releaseMcp(helperInfo.session).catch(()=>{});}helperInfo=undefined;controllerPromise=undefined;audit({event:'helper-invalidated',reason});}
  function validate(value) {
    if(typeof value?.href !== 'string' || value.href.length > 8192 || typeof value.clientName !== 'string' || value.clientName.length > 512) throw new Error('Invalid connection request');
    const url = new URL(value.href);
    if(url.protocol !== 'chrome-extension:' || url.hostname !== 'mmlmfjhmonkocbjadbfplnigmagldckm' || url.pathname !== '/connect.html')throw new Error('Invalid extension URL');
    const relay = new URL(url.searchParams.get('mcpRelayUrl'));
    if(relay.protocol !== 'ws:' || !['[::1]','127.0.0.1','localhost'].includes(relay.hostname) || !/^\/extension\/[a-f0-9-]+$/i.test(relay.pathname))throw new Error('Invalid local relay');
    const client=JSON.parse(url.searchParams.get('client'));
    if(client.name !== value.clientName || value.clientName.startsWith(CONTROLLER))throw new Error('Invalid connection client');
    return value;
  }
  async function openOnce(value) {
    const valid=validate(value);
    const session=await controller();
    // The URL (which contains the extension token) stays in memory and is never
    // written to logs, errors or output artifacts.
    const code=`() => (${openConnectionPage.toString()})(${JSON.stringify({href:valid.href,preferredWindowId})})`;
    let reply;try{reply=await call(session,'tools/call',{name:'browser_evaluate',arguments:{function:code}});}catch(error){invalidateHelper('transport-unavailable');throw error;}
    if(reply.result?.isError) {invalidateHelper('helper-page-unavailable');throw new Error('Helper page unavailable');}
    const text=(reply.result?.content??[]).find(c=>c.type==='text')?.text??'';
    const json=text.match(/^### Result\s*\n([\s\S]*?)(?=\n### |$)/)?.[1];
    const result=JSON.parse(json || '{}');
    if(!Number.isInteger(result.targetWindowId) || !Number.isInteger(result.tabId))throw new Error('Invalid helper result');
    preferredWindowId=result.targetWindowId;
    onConnectionOpened({clientName:valid.clientName,tabId:result.tabId});
    audit({event:'window-preference',reason:result.reason,targetWindowId:result.targetWindowId,openedBeforeAttach:true});
    return result;
  }
  function open(value){
    const valid=validate(value);
    const key=createHash('sha256').update(new URL(valid.href).searchParams.get('mcpRelayUrl')).digest('hex');
    const existing=openings.get(key);if(existing){if(existing.clientName!==valid.clientName)throw Error('Relay already belongs to another client');return existing.promise;}
    if(openings.size>=2048)throw Error('Connection registry limit reached; restart at a suitable time');
    const promise=openOnce(valid);openings.set(key,{clientName:valid.clientName,promise});
    // Failed/ambiguous attempts stay registered. Replaying one must never create
    // another page. A new backend connection supplies a fresh relay identifier.
    promise.catch(()=>{});return promise;
  }
  function handle(req,res) {
    if(req.method!=='POST'||req.headers.origin||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403);res.end();return;}
    const chunks=[];let size=0;
    req.on('data',chunk=>{size+=chunk.length;if(size>16384)req.destroy();else chunks.push(chunk);});
    req.on('end',()=>{
      let value;
      try{value=validate(JSON.parse(Buffer.concat(chunks).toString()));}catch{res.writeHead(400);res.end();return;}
      const task=queue.then(()=>open(value));queue=task.catch(()=>{});
      task.then(()=>{res.writeHead(204);res.end();},()=>{audit({event:'window-preference',reason:'connection-refused-no-duplicate-launch'});res.writeHead(503);res.end();});
    });
  }
  async function evaluate(code) {
    const task=queue.then(async()=>{
      const session=await controller();
      let reply;try{reply=await call(session,'tools/call',{name:'browser_evaluate',arguments:{function:code}});}catch(error){invalidateHelper('management-transport-unavailable');throw error;}
      if(reply.result?.isError){invalidateHelper('management-page-unavailable');throw new Error('Helper management operation failed');}
      const text=(reply.result?.content??[]).find(c=>c.type==='text')?.text??'';
      const json=text.match(/^### Result\s*\n([\s\S]*?)(?=\n### |$)/)?.[1];
      return JSON.parse(json||'{}');
    });
    queue=task.catch(()=>{});
    return task;
  }
  return {handle,open,validate,evaluate,diagnostics:()=>({preferredWindowId,helperReady:!!helperInfo,helperRecoveries,retiredHelpers:retiredHelpers.length,openingCount:openings.size,lastFailure})};
}
module.exports={createConnectionRouter,openConnectionPage};
