// Shadow Slave CanonDB v3.3 — REMOTE DATABASE RUNTIME
(function(){
'use strict';
const HOST=(typeof window!=='undefined')?(window.parent||window):globalThis;
const INSTANCE='__SHADOW_SLAVE_CANON_DB_V33_REMOTE__';
if(HOST[INSTANCE]) return;
HOST[INSTANCE]=true;

const DB_NAME='ShadowSlave_RED_CanonDB_v3';
const DB_VERSION=1;
const BUILD='v3.4-gameplay-correctness';
const MANIFEST_URL=new URL('../data/manifest.json', import.meta.url).href;
const CAT_CACHE=new Map();
let seedPromise=null;
let activeManifest=null;
function currentSourceHash(){return activeManifest?.raw_sha256||HOST.ShadowSlaveCanonDBStatus?.source_hash||null;}


HOST.ShadowSlaveCanonDBStatus={
  state:'BOOT',
  db_name:DB_NAME,
  build:BUILD,
  manifest_url:MANIFEST_URL,
  record_count:0,
  source_hash:'',
  last_error:null
};

function idbReq(req){return new Promise((res,rej)=>{req.onsuccess=()=>res(req.result);req.onerror=()=>rej(req.error||new Error('IndexedDB request failed'));});}
function txDone(tx){return new Promise((res,rej)=>{tx.oncomplete=()=>res();tx.onerror=()=>rej(tx.error||new Error('IndexedDB tx failed'));tx.onabort=()=>rej(tx.error||new Error('IndexedDB tx aborted'));});}
function openDb(){return new Promise((res,rej)=>{
  const q=indexedDB.open(DB_NAME,DB_VERSION);
  q.onupgradeneeded=()=>{const db=q.result;
    if(!db.objectStoreNames.contains('records')){
      const s=db.createObjectStore('records',{keyPath:'record_id'});
      s.createIndex('category','category',{unique:false});
      s.createIndex('volume','volume',{unique:false});
      s.createIndex('chapter_start','chapter_start',{unique:false});
    }
    if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
  };
  q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error||new Error('Cannot open CanonDB'));
});}
async function getMeta(key){const db=await openDb();try{const tx=db.transaction('meta','readonly');return await idbReq(tx.objectStore('meta').get(key));}finally{db.close();}}
async function sha256Hex(bytes){
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function fetchManifest(){
  const r=await fetch(MANIFEST_URL,{cache:'no-store',mode:'cors'});
  if(!r.ok)throw new Error(`CanonDB manifest HTTP ${r.status}`);
  const m=await r.json();
  if(!m||m.schema!=='shadow-slave-canondb-manifest-v1')throw new Error('Invalid Shadow Slave CanonDB manifest');
  if(!m.raw_sha256||!m.record_count)throw new Error('Manifest missing hash/count');
  return m;
}
async function fetchCanonText(m){
  const base=new URL('.',MANIFEST_URL);
  const gzPath=m.files?.gzip?.path||'';
  if(gzPath&&typeof DecompressionStream!=='undefined'){
    const gz=new URL(gzPath,base).href;
    const r=await fetch(gz,{cache:'force-cache',mode:'cors'});
    if(!r.ok)throw new Error(`CanonDB gzip HTTP ${r.status}`);
    const compressed=await r.arrayBuffer();
    if(m.files?.gzip?.sha256){
      const gh=await sha256Hex(compressed);
      if(gh!==m.files.gzip.sha256)throw new Error('CanonDB gzip SHA-256 mismatch');
    }
    const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  const plainPath=m.files?.plain_fallback?.path||'';
  if(!plainPath)throw new Error('No CanonDB plain fallback configured');
  const plain=new URL(plainPath,base).href;
  const r=await fetch(plain,{cache:'force-cache',mode:'cors'});
  if(!r.ok)throw new Error(`CanonDB plain HTTP ${r.status}`);
  return await r.text();
}
async function seed(){
  if(seedPromise)return seedPromise;
  seedPromise=(async()=>{
    HOST.ShadowSlaveCanonDBStatus.state='CHECKING_REMOTE';
    const existing=await getMeta('source_hash').catch(()=>null);
    const existingCount=await getMeta('record_count').catch(()=>null);
    const existingBuild=await getMeta('build').catch(()=>null);
    let m=null;
    try{m=await fetchManifest();}
    catch(e){
      if(existing?.value&&Number(existingCount?.value)>0){
        activeManifest={schema:'shadow-slave-canondb-manifest-v1',build:existingBuild?.value||'cached',record_count:Number(existingCount.value),raw_sha256:String(existing.value),offline_cached:true};
        HOST.ShadowSlaveCanonDBStatus.state='READY_CACHED_OFFLINE';
        HOST.ShadowSlaveCanonDBStatus.source_hash=String(existing.value);
        HOST.ShadowSlaveCanonDBStatus.record_count=Number(existingCount.value);
        HOST.ShadowSlaveCanonDBStatus.last_error=String(e?.message||e);
        return {seeded:false,offline_cached:true,record_count:Number(existingCount.value),source_hash:String(existing.value)};
      }
      throw e;
    }
    activeManifest=m;
    HOST.ShadowSlaveCanonDBStatus.source_hash=m.raw_sha256;
    HOST.ShadowSlaveCanonDBStatus.expected_records=Number(m.record_count)||0;
    if(existing?.value===m.raw_sha256 && Number(existingCount?.value)===Number(m.record_count)){
      HOST.ShadowSlaveCanonDBStatus.state='READY';
      HOST.ShadowSlaveCanonDBStatus.record_count=Number(m.record_count);
      return {seeded:false,record_count:Number(m.record_count),source_hash:m.raw_sha256};
    }

    HOST.ShadowSlaveCanonDBStatus.state='DOWNLOADING';
    const text=await fetchCanonText(m);
    const bytes=new TextEncoder().encode(text);
    HOST.ShadowSlaveCanonDBStatus.state='VERIFYING';
    const rawHash=await sha256Hex(bytes.buffer);
    if(rawHash!==m.raw_sha256)throw new Error(`CanonDB raw SHA-256 mismatch: ${rawHash}`);

    const lines=text.split(/\n/).filter(Boolean);
    if(lines.length!==Number(m.record_count))throw new Error(`CanonDB record count mismatch: ${lines.length}/${m.record_count}`);

    HOST.ShadowSlaveCanonDBStatus.state='SEEDING';
    const db=await openDb();
    try{
      let tx=db.transaction(['records','meta'],'readwrite');
      tx.objectStore('records').clear();tx.objectStore('meta').clear();await txDone(tx);

      const CHUNK=350;
      for(let i=0;i<lines.length;i+=CHUNK){
        tx=db.transaction('records','readwrite');const st=tx.objectStore('records');
        for(const line of lines.slice(i,i+CHUNK))st.put(JSON.parse(line));
        await txDone(tx);
        HOST.ShadowSlaveCanonDBStatus.seed_progress=Math.min(lines.length,i+CHUNK);
        if(i%1050===0)await new Promise(r=>setTimeout(r,0));
      }

      tx=db.transaction('meta','readwrite');const meta=tx.objectStore('meta');
      meta.put({key:'source_hash',value:m.raw_sha256});
      meta.put({key:'record_count',value:lines.length});
      meta.put({key:'build',value:m.build||BUILD});
      meta.put({key:'manifest_url',value:MANIFEST_URL});
      await txDone(tx);

      CAT_CACHE.clear();
      HOST.ShadowSlaveCanonDBStatus.state='READY';
      HOST.ShadowSlaveCanonDBStatus.record_count=lines.length;
      HOST.ShadowSlaveCanonDBStatus.seeded_at=new Date().toISOString();
      console.log('[Shadow Slave CanonDB] remote seed ready:',lines.length);
      return {seeded:true,record_count:lines.length,source_hash:m.raw_sha256};
    }finally{db.close();}
  })().catch(e=>{
    seedPromise=null;
    HOST.ShadowSlaveCanonDBStatus.state='ERROR';
    HOST.ShadowSlaveCanonDBStatus.last_error=String(e?.message||e);
    console.error('[Shadow Slave CanonDB] remote bootstrap failed',e);
    throw e;
  });
  return seedPromise;
}
async function getByIndex(indexName,key){await seed();const db=await openDb();try{const tx=db.transaction('records','readonly');const idx=tx.objectStore('records').index(indexName);return await idbReq(idx.getAll(key));}finally{db.close();}}
async function category(cat){if(CAT_CACHE.has(cat))return CAT_CACHE.get(cat);const rows=await getByIndex('category',cat);CAT_CACHE.set(cat,rows);return rows;}
async function getRecord(recordId){await seed();const db=await openDb();try{const tx=db.transaction('records','readonly');return await idbReq(tx.objectStore('records').get(String(recordId||'')));}finally{db.close();}}
function nrm(x){return String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9à-ỹ]+/gi,' ').replace(/\s+/g,' ').trim();}
function toks(x){return new Set(nrm(x).split(' ').filter(t=>t.length>=3));}
function volumeForChapter(ch){if(ch<=95)return 1;if(ch<=350)return 2;if(ch<=600)return 3;if(ch<=750)return 4;if(ch<=1060)return 5;if(ch<=1230)return 6;if(ch<=1590)return 7;if(ch<=1840)return 8;if(ch<=2260)return 9;if(ch<=2720)return 10;if(ch<=3000)return 11;return 12;}
function matchScore(r,query){const qt=toks(query);if(!qt.size)return 0;const rt=toks((r.name||'')+' '+((r.keys||[]).join(' ')));let hit=0;for(const t of qt)if(rt.has(t))hit++;return hit/qt.size;}
function charName(r){const m=String(r.name||'').match(/^SS \| NHÂN VẬT \| (.+?) \| V\d+/i);return m?m[1]:'';}
function sectionFrom(text,title){const esc=String(title).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const re=new RegExp('##\\s+'+esc+'\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|<\\/Character_Version>|$)','i');const m=text.match(re);return m?('## '+title+'\n'+m[1].trim()):'';}
function compactCharacter(r,currentChapter){const raw=String(r.content||'');const m=raw.match(/<Character_Version>[\s\S]*?<\/Character_Version>/i);const base=m?m[0]:raw;const title=(base.match(/^<Character_Version>\s*\n([^\n]+)/i)||[])[1]||r.name;const parts=[
  sectionFrom(base,'Phạm vi temporal'),sectionFrom(base,'Ngoại hình & khí chất'),sectionFrom(base,'Tính cách'),
  sectionFrom(base,'Cách nói chuyện & xưng hô'),sectionFrom(base,'Thói quen / sở thích / tiểu tiết đời thường'),sectionFrom(base,'Cấm viết sai')
].filter(Boolean);return `<TEMPORAL_DOSSIER_GUARD current_chapter="${currentChapter}">This volume dossier is BEHAVIORAL support only. Do not infer current powers, knowledge, relationship stage or possessions from later points in the volume; those require chapter evidence or SAVE state.</TEMPORAL_DOSSIER_GUARD>\n# ${title}\n${parts.join('\n\n')}`;}
function compactActiveScene(r,currentChapter){const raw=String(r.content||'');if(!(r.chapter_end&&Number(r.chapter_end)>Number(currentChapter)))return raw;const lines=[];for(const line of raw.split(/\n/)){const m=line.match(/\bCh\.(\d{1,4})\b/i);if(m&&Number(m[1])<=Number(currentChapter))lines.push(line);}const contract=(raw.match(/## MVU \/ EJS CONTRACT[\s\S]*?(?=<\/|$)/i)||[])[0]||'';return `<ACTIVE_RANGE_GUARD current_chapter="${currentChapter}" source_range="${r.chapter_start}-${r.chapter_end}">Future beats inside this range are hidden. Only chapter-tagged anchors at or before current_chapter may be used.</ACTIVE_RANGE_GUARD>\n${lines.join('\n')}\n${contract}`;}
function compact(r,query,currentChapter){let c=String(r.content||'');
  if(r.category==='CANON_CHARACTER_TEMPORAL')c=compactCharacter(r,currentChapter);
  if(r.category==='CANON_SCENE_EVIDENCE'&&r.subtype==='deep_scene')c=compactActiveScene(r,currentChapter);
  const caps={CANON_CHAPTER_EVIDENCE:5400,CANON_SCENE_EVIDENCE:4300,CANON_CHARACTER_TEMPORAL:5200,CANON_MECHANIC:2200,CANON_PROGRESSION:3600,CANON_LOCATION:1800,CANON_WORLD:2200,CANON_EVENT:1800,CANON_FACTION:1600,CANON_MISC:1800,CANON_HIDDEN:1400};
  const cap=caps[r.category]||1800;if(c.length>cap)c=c.slice(0,cap)+'\n[CanonDB: record compacted for turn budget]';return c;
}
function add(map,r,score,reason){if(!r||r.router_only)return;const prev=map.get(r.record_id);if(!prev||score>prev.score)map.set(r.record_id,{r,score,reason});}
async function retrieve(opts={}){
  await seed();
  const chapter=Math.max(1,Math.min(3130,Number(opts.chapter)||1));const volume=Number(opts.volume)||volumeForChapter(chapter);
  const query=String(opts.query||'');const location=String(opts.location||'');const actors=Array.isArray(opts.actors)?opts.actors.filter(Boolean):[];
  const qfull=query+' '+location+' '+actors.join(' ');const qMechanic=query;const map=new Map();const routerMeta=[];
  const exact=await getByIndex('chapter_start',chapter);
  for(const r of exact){if(r.category==='CANON_CHAPTER_EVIDENCE')add(map,r,100,'exact_chapter');else if(r.category==='ROUTER_INDEX')routerMeta.push(r);else if(r.category==='CANON_SCENE_EVIDENCE')add(map,r,94,'direct_anchor_exact');}
  for(const r of await category('CANON_SCENE_EVIDENCE')){if(r.chapter_start&&r.chapter_end&&r.chapter_start<=chapter&&chapter<=r.chapter_end)add(map,r,90,'active_scene_range');}
  const actorNorm=actors.map(nrm);const qn=nrm(query);
  for(const r of await category('CANON_CHARACTER_TEMPORAL')){if(Number(r.volume)!==volume)continue;const cn=charName(r),nn=nrm(cn);let hit=actorNorm.some(a=>a&&(a.includes(nn)||nn.includes(a)))||(nn&&qn.includes(nn));if(hit)add(map,r,92,'active_character_temporal');}
  const mechTerms=/rank|class|core|aspect|flaw|true name|memory|echo|shadow|essence|ability|domain|sorcery|weave|nightmare|spell|soul|cấp|lõi|khuyết|tên thật|ký ức|tiếng vọng|bóng|tinh chất|kỹ năng|ác mộng/i.test(qMechanic);
  if(mechTerms)for(const r of await category('CANON_MECHANIC')){if(r.volume&&Number(r.volume)>volume)continue;const ms=matchScore(r,qMechanic);if(ms<=0)continue;const rv=Number(r.volume||0);const temporal=rv?((rv===volume)?8:Math.max(-8,4-(volume-rv)*1.25)):5;add(map,r,74+temporal+Math.min(15,ms*30),'mechanic_match');}
  if(mechTerms)for(const r of await category('CANON_PROGRESSION')){if(!r.volume||Number(r.volume)===volume)add(map,r,68,'progression_support');}
  const mandatoryMechanics=Array.isArray(opts.mandatoryMechanics)?opts.mandatoryMechanics.filter(Boolean):[];
  if(mandatoryMechanics.length){for(const r of await category('CANON_MECHANIC')){const hay=nrm((r.name||'')+' '+((r.keys||[]).join(' ')));for(const term of mandatoryMechanics){const tn=nrm(term);if(tn&&hay.includes(tn)){add(map,r,99,'state_required_mechanic');break;}}}}
  for(const cat of ['CANON_LOCATION','CANON_EVENT','CANON_WORLD','CANON_FACTION','CANON_MISC']){for(const r of await category(cat)){if(r.volume&&Number(r.volume)!==volume)continue;let s=matchScore(r,qfull);if(r.chapter_start&&r.chapter_end&&r.chapter_start<=chapter&&chapter<=r.chapter_end)s=Math.max(s,.9);if(s>.12)add(map,r,55+Math.min(20,s*25),cat.toLowerCase()+'_match');}}
  const sorted=Array.from(map.values()).sort((a,b)=>b.score-a.score);
  const categoryLimits={CANON_CHAPTER_EVIDENCE:1,CANON_SCENE_EVIDENCE:3,CANON_CHARACTER_TEMPORAL:5,CANON_MECHANIC:4,CANON_PROGRESSION:1,CANON_LOCATION:3,CANON_EVENT:2,CANON_WORLD:2,CANON_FACTION:1,CANON_MISC:2,CANON_HIDDEN:1};
  const usedCat={};const maxChars=Math.max(12000,Number(opts.maxChars)||36000);let used=0;const blocks=[];const selected=[];
  for(const x of sorted){const r=x.r;const lim=categoryLimits[r.category]??2;usedCat[r.category]=(usedCat[r.category]||0);if(usedCat[r.category]>=lim)continue;let content=compact(r,qfull,chapter);const block=`<CANON_RECORD id="${r.record_id}" category="${r.category}" evidence="${r.evidence_quality||''}" source_tier="${r.source_tier||''}" reason="${x.reason}">\n<NAME>${r.name}</NAME>\n${content}\n</CANON_RECORD>`;
    const hard=x.score>=90;if(!hard&&used+block.length>maxChars)continue;blocks.push(block);used+=block.length;usedCat[r.category]++;selected.push({id:r.record_id,name:r.name,category:r.category,score:x.score,reason:x.reason});
  }
  const timeMeta=routerMeta.map(r=>({record_id:r.record_id,time_slot:r.time_slot,sim_time_start:r.sim_time_start,sim_time_end:r.sim_time_end,detail_authority:r.detail_authority}));
  const sh=currentSourceHash();
  const context=`<SS_CANON_PACKET chapter="${chapter}" volume="V${volume}" source_hash="${sh?sh.slice(0,12):'UNKNOWN'}">\n<PROVENANCE_RULE>Only records below may support original-canon claims this turn. INDEX_ONLY metadata is never narrative authority. SAVE/roleplay facts must not be promoted to canon.</PROVENANCE_RULE>\n${blocks.join('\n')}\n</SS_CANON_PACKET>`;
  return {context,selected,router_meta:timeMeta,chars:context.length,chapter,volume,source_hash:sh};
}
async function stats(){await seed();const db=await openDb();try{const tx=db.transaction(['records','meta'],'readonly');const count=await idbReq(tx.objectStore('records').count());return {ready:true,count,source_hash:currentSourceHash(),manifest_url:MANIFEST_URL,db_name:DB_NAME,build:BUILD,state:HOST.ShadowSlaveCanonDBStatus?.state||'READY'};}finally{db.close();}}
async function clear(){const db=await openDb();try{let tx=db.transaction(['records','meta'],'readwrite');tx.objectStore('records').clear();tx.objectStore('meta').clear();await txDone(tx);CAT_CACHE.clear();seedPromise=null;}finally{db.close();}return true;}
HOST.ShadowSlaveCanonDB={
  ready:seed,
  retrieve,
  getRecord,
  stats,
  reseed:async()=>{await clear();return seed();},
  clear,
  manifest:()=>activeManifest,
  manifestUrl:MANIFEST_URL,
  build:BUILD
};
seed().catch(()=>{});
})();
