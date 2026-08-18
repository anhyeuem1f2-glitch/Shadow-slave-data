// Shadow Slave v3.1 — Operational SAVE Validator
// Purpose: make important setting rules executable instead of passive lore text.
(function(){
'use strict';
const HOST=(window.parent||window);
const INSTANCE='__SHADOW_SLAVE_SAVE_VALIDATOR_V31__';
if(HOST[INSTANCE])return; HOST[INSTANCE]=true;
const RANKS=['mundane','dormant','awakened','ascended','transcendent','supreme','sacred','divine'];
const CLASSES=['beast','monster','demon','devil','tyrant','terror','titan'];
const KNOW_PATHS=new Set(['witnessed','told','public','ability','vision','memory_or_vision','inference','user_correction']);
const ALLOW_UNEARNED=new Set(['self_earned','earned','loot','looted','crafted','self_crafted','spell_reward','nightmare_reward','hunt_reward','discovered','claimed_from_defeated_enemy']);
const BLOCK_UNEARNED=new Set(['purchased','bought','gift','gifted','borrowed','loan','transferred','inherited']);
const HIGH_REWARD=/rank|class|core|aspect|ability|true\s*name|domain|lineage/i;
let lastGood=null,guard=false,timer=null,lastReport={status:'INIT',issues:[],at:0};
function clone(x){return JSON.parse(JSON.stringify(x||{}));}
function norm(x){return String(x??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[\s-]+/g,'_');}
function findSheet(data,key,name){if(data?.[key])return data[key];for(const k of Object.keys(data||{})){if(data[k]?.name===name)return data[k];}return null;}
function ctx(sheet){if(!sheet||!Array.isArray(sheet.content)||!Array.isArray(sheet.content[0]))return null;const h=sheet.content[0].map(String),m={};h.forEach((x,i)=>m[x]=i);return {sheet,h,m,rows:sheet.content.slice(1).filter(Array.isArray)};}
function get(r,c,n,d=''){const i=c?.m?.[n];return i===undefined?d:(r[i]??d);}
function set(r,c,n,v){let i=c.m[n];if(i===undefined){c.m[n]=c.h.length;c.h.push(n);c.sheet.content[0].push(n);i=c.m[n];for(const row of c.rows)while(row.length<c.h.length)row.push('');}while(r.length<c.h.length)r.push('');if(String(r[i]??'')!==String(v??'')){r[i]=v;return true;}return false;}
function rowsBy(c,col){const out=new Map();if(!c)return out;for(const r of c.rows){const k=String(get(r,c,col,'')).trim();if(k)out.set(k,r);}return out;}
function issue(list,rule,severity,target,detail){list.push({rule,severity,target,detail});}
function hasEvent(code,chron){const x=String(code||'').trim();if(!x)return false;if(/^(GENESIS|SYSTEM_INIT|USER_CORRECTION)(:|$)/i.test(x))return true;return chron.has(x);}
function rankIndex(v){return RANKS.indexOf(norm(v));}function classIndex(v){return CLASSES.indexOf(norm(v));}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function flawRule(playerRow,pc){let id=norm(get(playerRow,pc,'Flaw Rule ID',''));const txt=norm(get(playerRow,pc,'Flaw',''));
  if(id)return id.toUpperCase();
  if(/khong_the_su_dung.*khong.*tu_(kiem|gianh|dat)|cannot_use.*not.*(earn|acquire)|can_t_use.*not.*earn|must_personally_earn/.test(txt))return 'NO_UNEARNED_ITEMS';
  return '';
}
async function canonRecord(id){const rid=String(id||'').trim();if(!/^SSREC_\d{6}$/i.test(rid))return null;try{return await HOST.ShadowSlaveCanonDB?.getRecord?.(rid)||null;}catch(e){return null;}}
async function validateTables(current,previous){
  const data=clone(current),prev=previous?clone(previous):null,issues=[];let changed=false;
  const runtime=ctx(findSheet(data,'sheet_ss_runtime','SS Runtime State'));
  const player=ctx(findSheet(data,'sheet_ss_player','SS Player State'));
  const inv=ctx(findSheet(data,'sheet_ss_inventory','SS Inventory'));
  const rel=ctx(findSheet(data,'sheet_ss_relationships','SS Relationships'));
  const know=ctx(findSheet(data,'sheet_ss_knowledge','SS Knowledge'));
  const div=ctx(findSheet(data,'sheet_ss_divergence','SS Divergence'));
  const rew=ctx(findSheet(data,'sheet_ss_reward','SS Reward Log'));
  const chr=ctx(findSheet(data,'sheet_ss_chronicle','Bảng Kỷ Yếu'));
  const prevPlayer=prev?ctx(findSheet(prev,'sheet_ss_player','SS Player State')):null;
  const prevChr=prev?ctx(findSheet(prev,'sheet_ss_chronicle','Bảng Kỷ Yếu')):null;
  const chron=rowsBy(chr,'Chỉ Mục Mã Hóa');

  // A) Chronicle is append-only. Prior AM rows cannot disappear or silently mutate.
  if(chr&&prevChr){
    const curMap=rowsBy(chr,'Chỉ Mục Mã Hóa'),oldMap=rowsBy(prevChr,'Chỉ Mục Mã Hóa');
    for(const [code,oldRow] of oldMap){const now=curMap.get(code);if(!now){chr.sheet.content.push(clone(oldRow));chr.rows.push(chr.sheet.content[chr.sheet.content.length-1]);changed=true;issue(issues,'SAVE_HISTORY_APPEND_ONLY','error',code,'Deleted prior memory restored.');}
      else if(JSON.stringify(now)!==JSON.stringify(oldRow)){const idx=chr.sheet.content.indexOf(now);chr.sheet.content[idx]=clone(oldRow);changed=true;issue(issues,'SAVE_HISTORY_IMMUTABLE_PRIOR','error',code,'Modified prior memory reverted.');}}
    // Rebuild context after possible restores.
  }
  if(chr){
    const used=new Set();let max=0;for(const r of chr.rows){const c=String(get(r,chr,'Chỉ Mục Mã Hóa','')).trim();const m=c.match(/^AM(\d+)$/i);if(m){max=Math.max(max,Number(m[1]));if(!used.has(c.toUpperCase())){used.add(c.toUpperCase());continue;}}max++;const nc='AM'+String(max).padStart(4,'0');changed|=set(r,chr,'Chỉ Mục Mã Hóa',nc);used.add(nc);issue(issues,'SAVE_MEMORY_CODE_REPAIR','warn',nc,'Missing/duplicate AM code normalized.');}
  }
  const chron2=rowsBy(chr,'Chỉ Mục Mã Hóa');

  // B) Reward provenance is computed, never trusted from model output.
  const validRewards=[];
  if(rew){for(const r of rew.rows){const uid=String(get(r,rew,'Reward UID','')).trim()||`row:${get(r,rew,'row_id','?')}`;const kind=String(get(r,rew,'Kind',''));const src=String(get(r,rew,'Source Event','')).trim();const auth=String(get(r,rew,'Rule Authority','')).trim();const cost=String(get(r,rew,'Cost','')).trim();let ok=true,why=[];
      if(!src||!hasEvent(src,chron2)){ok=false;why.push('Source Event does not resolve to SAVE history/allowed bootstrap event.');}
      if(!auth){ok=false;why.push('Rule Authority missing.');}
      if(/^SSREC_\d{6}$/i.test(auth)){const rec=await canonRecord(auth);if(!rec){ok=false;why.push('Canon Rule Authority ID not found.');}}
      else if(auth&&!/^(SAVE_RULE|GENESIS_RULE|USER_CORRECTION|SYSTEM_RULE):/i.test(auth)){ok=false;why.push('Rule Authority must be SSREC_xxxxxx or explicit SAVE/GENESIS/SYSTEM rule.');}
      if(HIGH_REWARD.test(kind)&&!cost){ok=false;why.push('High-impact reward/progression requires explicit cost/condition.');}
      changed|=set(r,rew,'Validated',ok?'Yes':'No');changed|=set(r,rew,'Rejection Reason',ok?'':why.join(' '));
      if(ok)validRewards.push({uid,kind:norm(kind),name:norm(get(r,rew,'Name','')),src,auth});else issue(issues,'REWARD_PROVENANCE','error',uid,why.join(' '));
  }}

  // C) Player progression: no free step, no multi-step jump, no silent regression.
  if(player&&player.rows[0]&&prevPlayer&&prevPlayer.rows[0]){const r=player.rows[0],o=prevPlayer.rows[0];const ev=String(get(r,player,'Last Progression Event','')).trim(),auth=String(get(r,player,'Last Progression Authority','')).trim();
    const authorityOk=!!ev&&hasEvent(ev,chron2)&&!!auth&&(/^SSREC_\d{6}$/i.test(auth)||/^(SAVE_RULE|GENESIS_RULE|USER_CORRECTION|SYSTEM_RULE):/i.test(auth));
    for(const [field,indexer] of [['Rank',rankIndex],['Class',classIndex]]){const a=indexer(get(o,prevPlayer,field,'')),b=indexer(get(r,player,field,''));if(a>=0&&b>=0&&a!==b){if(b<a||b-a>1||(!authorityOk&&b>a)){changed|=set(r,player,field,get(o,prevPlayer,field,''));issue(issues,'PROGRESSION_GATE','error',field,`Illegal ${field} transition reverted; event/rule authority required and multi-step jumps are blocked.`);}}}
    const oc=num(get(o,prevPlayer,'Soul Cores','')),nc=num(get(r,player,'Soul Cores',''));if(oc!==null&&nc!==null&&oc!==nc){if(nc<0||nc>7||nc<oc||nc-oc>1||(!authorityOk&&nc>oc)){changed|=set(r,player,'Soul Cores',get(o,prevPlayer,'Soul Cores',''));issue(issues,'CORE_GATE','error','Soul Cores','Illegal core change reverted.');}}
  }
  if(player&&player.rows[0]){const r=player.rows[0];const f=num(get(r,player,'Fragments',''));if(f!==null&&f<0){changed|=set(r,player,'Fragments','0');issue(issues,'FRAGMENT_NONNEGATIVE','warn','Fragments','Negative fragments normalized to 0.');}}

  // D) Flaw enforcement + inventory reward integrity.
  let fr='';if(player&&player.rows[0]){fr=flawRule(player.rows[0],player);if(fr&&get(player.rows[0],player,'Flaw Rule ID','')!==fr){changed|=set(player.rows[0],player,'Flaw Rule ID',fr);}}
  if(inv){for(const r of inv.rows){const uid=String(get(r,inv,'Item UID','')).trim()||String(get(r,inv,'Name','')).trim();const method=norm(get(r,inv,'Acquisition Method',''));const ev=String(get(r,inv,'Acquisition Event','')).trim();let blocked=false,why=[];
      if(!ev||!hasEvent(ev,chron2)){blocked=true;why.push('Acquisition Event missing/unresolved.');}
      if(fr==='NO_UNEARNED_ITEMS'&&(BLOCK_UNEARNED.has(method)||(!ALLOW_UNEARNED.has(method)&&method!==''))){blocked=true;why.push('Flaw NO_UNEARNED_ITEMS forbids this acquisition/use path.');}
      if(/reward/.test(method)){const ok=validRewards.some(x=>x.src===ev||x.name===norm(get(r,inv,'Name','')));if(!ok){blocked=true;why.push('Reward item has no validated Reward Log provenance.');}}
      if(blocked){changed|=set(r,inv,'Usable','No');changed|=set(r,inv,'State','BLOCKED_BY_VALIDATOR');let note=String(get(r,inv,'Notes',''));const tag='[SS_VALIDATOR] '+why.join(' ');if(!note.includes('[SS_VALIDATOR]'))changed|=set(r,inv,'Notes',(note?note+' ':'')+tag);issue(issues,'INVENTORY_GATE','error',uid,why.join(' '));}
  }}

  // E) Relationship axes are bounded; debt is intentionally unbounded.
  if(rel){const fields=['Trust','Respect','Affection','Attraction','Fear','Suspicion','Hostility','Loyalty','Vulnerability'];for(const r of rel.rows)for(const f of fields){const v=num(get(r,rel,f,''));if(v!==null){const c=Math.max(-100,Math.min(100,v));if(c!==v){changed|=set(r,rel,f,String(c));issue(issues,'RELATIONSHIP_CLAMP','warn',String(get(r,rel,'Entity ID','')),`${f} clamped to [-100,100].`);}}}}

  // F) Knowledge gate: source path required. Future canon cannot appear by inference/public alone.
  const runtimeRow=runtime?.rows?.[0];const currentChapter=num(runtimeRow?get(runtimeRow,runtime,'Chapter',''):null);
  if(know){for(const r of know.rows){const uid=String(get(r,know,'Knowledge UID','')).trim()||`row:${get(r,know,'row_id','?')}`;const by=norm(get(r,know,'Acquired By',''));const ev=String(get(r,know,'Acquired Event','')).trim();const rid=String(get(r,know,'Canon Record ID','')).trim();let ok=KNOW_PATHS.has(by),why=[];if(!ok)why.push('Unknown/absent information path.');
      let rec=null;if(rid){rec=await canonRecord(rid);if(!rec){ok=false;why.push('Canon Record ID not found.');}}
      if(rec&&currentChapter!==null&&Number(rec.chapter_start||0)>currentChapter){if(!['witnessed','told','ability','vision','memory_or_vision','user_correction'].includes(by)||!ev||!hasEvent(ev,chron2)){ok=false;why.push('Future-canon fact requires explicit in-world reveal event; inference/public is insufficient.');}}
      changed|=set(r,know,'Validation State',ok?'VALID':'REJECTED');changed|=set(r,know,'Rejection Reason',ok?'':why.join(' '));if(!ok)issue(issues,'KNOWLEDGE_GATE','error',uid,why.join(' '));
  }}

  // G) Divergence severity/status normalization; never delete divergence just to restore canon.
  if(div){for(const r of div.rows){const sev=norm(get(r,div,'Severity',''));if(sev&&!['minor','moderate','major','worldline'].includes(sev)){changed|=set(r,div,'Severity','moderate');issue(issues,'DIVERGENCE_SEVERITY','warn',String(get(r,div,'Divergence UID','')),'Unknown severity normalized to moderate.');}}}

  return {data,changed:Boolean(changed),issues};
}
async function run(){if(guard)return;const api=HOST.ShadowSlaveAutoDBAPI;if(!api?.exportTableAsJson)return;const current=clone(api.exportTableAsJson()||{});if(!current.sheet_ss_runtime)return;if(!lastGood){lastGood=clone(current);lastReport={status:'BASELINED',issues:[],at:Date.now()};return;}
  try{const res=await validateTables(current,lastGood);lastReport={status:res.issues.some(x=>x.severity==='error')?'REPAIRED_OR_REJECTED':'PASS',issues:res.issues,at:Date.now()};if(res.changed){guard=true;try{await api.importTableAsJson(JSON.stringify(res.data),{persist:true});lastGood=clone(res.data);console.warn('[Shadow Slave SAVE Validator] repaired/rejected',res.issues);}finally{guard=false;}}else lastGood=clone(current);}catch(e){lastReport={status:'ERROR',issues:[{detail:String(e)}],at:Date.now()};console.warn('[Shadow Slave SAVE Validator] error',e);}}
function schedule(){if(guard)return;clearTimeout(timer);timer=setTimeout(run,120);}
async function bind(timeout=25000){const s=Date.now();while(Date.now()-s<timeout){const api=HOST.ShadowSlaveAutoDBAPI;if(api?.registerTableUpdateCallback){lastGood=clone(api.exportTableAsJson?.()||{});api.registerTableUpdateCallback(schedule);console.log('[Shadow Slave SAVE Validator] operational validator bound.');return true;}await new Promise(r=>setTimeout(r,250));}console.warn('[Shadow Slave SAVE Validator] AutoDB API unavailable.');return false;}
HOST.ShadowSlaveSaveValidator={validateTables,run,status:()=>clone(lastReport),resetBaseline:()=>{lastGood=clone(HOST.ShadowSlaveAutoDBAPI?.exportTableAsJson?.()||{});return true;}};
bind();
})();
