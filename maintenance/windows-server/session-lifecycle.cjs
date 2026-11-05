const IDLE_MS=5*60*1000;
const INSTRUCTIONS='Work in the background by default. Tab selection must not foreground a window. If a click or fill fails, inspect fresh state before retrying. If rendering/occlusion is the plausible cause, call browser_bring_to_front with a concrete reason; it intentionally foregrounds only your current page. Recheck state and avoid duplicate actions. When browser work is complete and no tabs need to be handed to the user, call browser_session_finish or browser_close to delete only this conversation\'s group and release its session. Use browser_tabs(action="close") for a single tab. Do not finish if work is still running or the user asked to keep tabs. Welcome-only groups expire after five minutes without browser activity. The window-router helper is excluded.';
const FINISH_TOOL={name:'browser_session_finish',description:'Finish this conversation\'s browser work: permanently remove its saved Chrome tab group and close its tabs. Call when browser work is done. Set keepTabs=true to delete the group but hand website tabs to the user. Never closes another conversation or the window-router helper.',inputSchema:{type:'object',properties:{keepTabs:{type:'boolean',default:false,description:'Keep website tabs open, ungrouped, for the user; close only connection Welcome tabs.'}},additionalProperties:false},annotations:{title:'Finish browser session and delete group',readOnlyHint:false,destructiveHint:true,openWorldHint:false}};
function advertiseTools(result){const tools=[...(result.tools??[])].map(tool=>tool.name==='browser_close'?{...tool,description:'Finish browser work: delete this conversation\'s saved Chrome group, close its tabs and release its session. Call when browser work is done, unless the user wants the tabs left open. To close just one tab use browser_tabs(action="close").'}:tool);if(!tools.some(t=>t.name===FINISH_TOOL.name))tools.push(FINISH_TOOL);return {...result,tools};}
function createSessionLifecycle({manageGroups,release,audit,now=Date.now,idleMs=IDLE_MS,persist=()=>{},restored=[]}){
 const records=new Map();let sweeping=false;
 const recoverable=new Map(restored.map(r=>[r.key,r]));
 function save(){persist([...records.values()].map(r=>({key:r.key,seeds:r.seeds,knownGroups:r.knownGroups,lastActivity:r.lastActivity})));}
 function bind(key,bound){let r=records.get(key);if(!r||r.bound!==bound){r={key,bound,seeds:[],knownGroups:[],lastActivity:now(),active:0,uncertain:false,closing:false};const old=recoverable.get(key);if(old){r.seeds=old.seeds??[];r.knownGroups=old.knownGroups??[];recoverable.delete(key);}records.set(key,r);save();}return r;}
 function notePage({clientName,tabId}){const match=/^ChatGPT ([a-f0-9]{8})(?: \(\d+\))?$/.exec(clientName);if(!match)return;const candidates=[...records.values()].filter(r=>r.key.startsWith(match[1])&&!r.closing);if(candidates.length!==1)return;const r=candidates[0];r.seeds.push({tabId,clientName});r.lastActivity=now();save();}
 function begin(key){const r=records.get(key);if(!r)throw Error('Session not registered');if(r.closing)throw Error('Session cleanup in progress; retry the browser action');r.active++;r.lastActivity=now();return r;}
 function end(r,{uncertain=false}={}){r.active=Math.max(0,r.active-1);r.lastActivity=now();save();r.uncertain=r.uncertain||uncertain;if(!uncertain&&r.seeds.length&&!r.closing){void capture(r);}}
 async function capture(r){if(r.capturing)return;r.capturing=true;try{const result=await manageGroups({mode:'inspect',seeds:r.seeds,knownGroups:r.knownGroups});if(records.get(r.key)===r&&result.groups)r.knownGroups=result.groups;save();}catch{}finally{r.capturing=false;}}
 async function finish(key,{idle=false,keepTabs=false}={}){
  const r=records.get(key);if(!r)return {status:'already-finished',groupsDeleted:0,tabsClosed:0,tabsKept:0};
  if(r.closing)throw Error('Session cleanup already in progress');
  if(r.active>0)throw Error('Browser requests are still running; finish after they complete');
  if(idle&&(r.uncertain||now()-r.lastActivity<idleMs))return {status:'not-idle'};
  r.closing=true;
  try{
   const result=r.seeds.length?await manageGroups({mode:idle?'idle':'finish',seeds:r.seeds,knownGroups:r.knownGroups,keepTabs}):{status:'deleted',groupsDeleted:0,tabsClosed:0,tabsKept:0,verifiedGroupAbsent:true};
   if(result.status==='partial-idle-cleanup'){
    r.knownGroups=result.remainingGroups??r.knownGroups;r.cleanupStatus='website-tabs-kept';r.closing=false;
    audit({event:'session-partial-idle-cleanup',conversation:key.slice(0,16),groupsDeleted:result.groupsDeleted,tabsClosed:result.tabsClosed,remainingGroups:r.knownGroups.length});return result;
   }
   if(result.status!=='deleted'){if(r.cleanupStatus!==result.status)audit({event:'session-cleanup-skipped',conversation:key.slice(0,16),reason:result.status});r.cleanupStatus=result.status;r.closing=false;return result;}
   await release(key,r.bound);
   if(records.get(key)===r)records.delete(key);save();
   audit({event:'session-finished',conversation:key.slice(0,16),reason:idle?'welcome-idle':'explicit',groupsDeleted:result.groupsDeleted,tabsClosed:result.tabsClosed,tabsKept:result.tabsKept,ungroupedBeforeClose:result.ungroupedBeforeClose??false});
   return result;
  }catch(error){r.closing=false;throw error;}
 }
 async function finishLastTab(key,args={}){const r=records.get(key);if(!r||!r.seeds.length||r.active||r.closing||('index' in args&&args.index!==0))return null;const state=await manageGroups({mode:'inspect',seeds:r.seeds,knownGroups:r.knownGroups});if(state.groups?.length===1&&state.tabCount===1&&!state.protectedSeeds)return finish(key);return null;}
 async function sweep(){if(sweeping)return;sweeping=true;try{for(const r of [...records.values()]){if(r.active===0&&!r.uncertain&&!r.closing&&now()-r.lastActivity>=idleMs){try{await finish(r.key,{idle:true});}catch{audit({event:'session-cleanup-deferred',conversation:r.key.slice(0,16)});}}}}finally{sweeping=false;}}
 return {bind,notePage,begin,end,finish,finishLastTab,sweep,records};
}
module.exports={IDLE_MS,INSTRUCTIONS,FINISH_TOOL,advertiseTools,createSessionLifecycle};
