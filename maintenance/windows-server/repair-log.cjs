const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const KEEP_MS=24*60*60*1000;
function createLogger(directory,{now=Date.now}={}){
 fs.mkdirSync(directory,{recursive:true});
 function write(data){const stamp=new Date(now()).toISOString();fs.appendFileSync(path.join(directory,'events-'+stamp.slice(0,10)+'.jsonl'),JSON.stringify({time:stamp,...data})+'\n');}
 function cleanup(){let removed=0;for(const name of fs.readdirSync(directory)){if(!/^(?:events-\d{4}-\d{2}-\d{2}\.jsonl|archive-[\w.-]+\.log)$/.test(name))continue;const file=path.join(directory,name);if(now()-fs.statSync(file).mtimeMs>KEEP_MS){fs.unlinkSync(file);removed++;}}return removed;}
 return {write,cleanup};
}
const fingerprint=value=>crypto.createHash('sha256').update(String(value??'')).digest('hex').slice(0,16);
let logger;
function runtime(event,data={}){
 try{
  logger??=createLogger(path.join(__dirname,'logs'));
  // Only explicit metadata. Never store arbitrary errors, URLs or tool arguments.
  const out={source:'runtime',event};
  for(const key of ['tabId','groupId','attempt','count','durationMs','backendId'])if(Number.isFinite(data[key]))out[key]=data[key];
  for(const key of ['isError','success'])if(typeof data[key]==='boolean')out[key]=data[key];
  for(const key of ['tool','method','extensionEvent'])if(/^[a-zA-Z0-9_.:-]{1,100}$/.test(data[key]??''))out[key]=data[key];
  if(data.clientName)out.client=fingerprint(data.clientName);
  if(data.reason){out.reasonHash=fingerprint(data.reason);out.reason=['target_closed','canceled_by_user','All controlled tabs detached','User disconnected','Playwright client disconnected'].find(r=>String(data.reason).includes(r))??'other';}
  logger.write(out);
 }catch{}
}
module.exports={KEEP_MS,createLogger,runtime,fingerprint};
