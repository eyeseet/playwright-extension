// Called only from the private helper page. URLs and tokens never leave Chrome.
async function orphanWelcomes({exclude=[],closeIds=[]}){
 const own=await chrome.tabs.getCurrent(),tabs=await chrome.tabs.query({}),groups=await chrome.tabGroups.query({});
 const candidates=[];
 for(const t of tabs){if(t.id===own.id||exclude.includes(t.id))continue;let u,c;try{u=new URL(t.url);c=JSON.parse(u.searchParams.get('client'));}catch{continue;}
 if(u.origin!==location.origin||u.pathname!=='/connect.html'||!/^ChatGPT [a-f0-9]{8}$/.test(c?.name??''))continue;
 if(t.groupId>=0){const g=groups.find(g=>g.id===t.groupId);if(!g?.title?.startsWith('Playwright · '+c.name)||tabs.some(x=>x.groupId===t.groupId&&x.id!==t.id))continue;}
 candidates.push({tabId:t.id,groupId:t.groupId,lastAccessed:t.lastAccessed??Date.now()});
 }
 const selected=candidates.filter(t=>closeIds.includes(t.tabId));
 for(const t of selected){await chrome.tabs.ungroup([t.tabId]);await chrome.tabs.remove(t.tabId);}
 return {candidates:candidates.filter(t=>!closeIds.includes(t.tabId)),closed:selected.length};
}
module.exports={orphanWelcomes};
