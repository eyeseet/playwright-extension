// Runs in the existing helper extension page, never in the session being deleted.
async function manageOwnedGroups({mode,seeds,knownGroups=[],keepTabs=false}){
 if(location.origin!=='chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm')throw Error('Helper extension page required');
 const helper=await chrome.tabs.getCurrent();
 const [allGroups,allTabs]=await Promise.all([chrome.tabGroups.query({}),chrome.tabs.query({})]);
 const welcome=tab=>{try{const u=new URL(tab.url);return u.protocol==='chrome-extension:'&&u.hostname==='mmlmfjhmonkocbjadbfplnigmagldckm'&&u.pathname==='/connect.html';}catch{return false;}};
 const allowedTitles=new Set(seeds.map(s=>'Playwright · '+s.clientName));
 const known=new Map(knownGroups.map(g=>[g.id,g.title]));
 const groups=allGroups.filter(g=>g.id!==helper.groupId&&!g.title?.startsWith('Playwright · Playwright Window Router')&&[...allowedTitles].some(title=>g.title===title||(g.title?.startsWith(title)&&/^ \(\d+\)$/.test(g.title.slice(title.length))))&&(known.get(g.id)===g.title||seeds.some(s=>allTabs.some(t=>t.id===s.tabId&&t.groupId===g.id))));
 let snapshots=groups.map(g=>({id:g.id,title:g.title,tabIds:allTabs.filter(t=>t.groupId===g.id).map(t=>t.id)}));
 const orphanWelcome=allTabs.filter(t=>t.id!==helper.id&&t.groupId===-1&&welcome(t)&&seeds.some(s=>s.tabId===t.id));
 let tabs=allTabs.filter(t=>snapshots.some(g=>g.tabIds.includes(t.id)));
 const protectedSeeds=seeds.some(s=>allTabs.some(t=>t.id===s.tabId&&t.groupId>=0&&!snapshots.some(g=>g.id===t.groupId)));
 if(mode==='inspect')return {groups:snapshots.map(({id,title})=>({id,title})),tabCount:tabs.length,onlyWelcome:tabs.length===snapshots.length&&tabs.every(welcome),protectedSeeds};
 if(protectedSeeds)return {status:'protected-group'};
 const retained=mode==='idle'?snapshots.filter(g=>g.tabIds.length!==1||!allTabs.filter(t=>g.tabIds.includes(t.id)).every(welcome)):[];
 if(mode==='idle'){
  snapshots=snapshots.filter(g=>!retained.includes(g));
  tabs=allTabs.filter(t=>snapshots.some(g=>g.tabIds.includes(t.id)));
  if(!snapshots.length&&!orphanWelcome.length&&retained.length)return {status:'website-tabs-kept'};
 }
 // Check membership again immediately before ungrouping; do not race a user edit.
 const current=await chrome.tabs.query({});const currentGroups=await chrome.tabGroups.query({});
 for(const g of snapshots){const live=current.filter(t=>t.groupId===g.id);if(!currentGroups.some(x=>x.id===g.id&&x.title===g.title)||live.length!==g.tabIds.length||live.some(t=>!g.tabIds.includes(t.id))||(mode==='idle'&&live.some(t=>!welcome(t))))return {status:'group-changed'};}
 const groupedIds=tabs.map(t=>t.id);
 // Ungroup explicitly deletes the saved group. Closing the grouped tabs first
 // would instead leave a restorable group in Chrome's saved-groups menu.
 if(groupedIds.length)await chrome.tabs.ungroup(groupedIds);
 const remainingGroups=await chrome.tabGroups.query({});
 if(snapshots.some(g=>remainingGroups.some(x=>x.id===g.id)))throw Error('Group removal not confirmed');
 const after=await chrome.tabs.query({});
 const ownedIds=new Set([...groupedIds,...orphanWelcome.map(t=>t.id)]);
 const removable=after.filter(t=>ownedIds.has(t.id)&&t.groupId===-1&&(mode==='idle'||keepTabs?welcome(t):true));
 // Website tabs deliberately handed off, or navigated during an idle check,
 // remain open but no longer belong to an automation group.
 if(removable.length)await chrome.tabs.remove(removable.map(t=>t.id));
 const finalTabs=await chrome.tabs.query({});
 if(removable.some(t=>finalTabs.some(x=>x.id===t.id)))throw Error('Tab close not confirmed');
 return {status:retained.length?'partial-idle-cleanup':'deleted',remainingGroups:retained.map(({id,title})=>({id,title})),groupsDeleted:snapshots.length,tabsClosed:removable.length,tabsKept:finalTabs.filter(t=>ownedIds.has(t.id)).length,ungroupedBeforeClose:true,verifiedGroupAbsent:true};
}
module.exports={manageOwnedGroups};
