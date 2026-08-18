// Shadow Slave v3.4.2 remote runtime entrypoint — MICROAUDIT + CANON DIRECTOR AI2
const HOST=(typeof window!=='undefined')?(window.parent||window):globalThis;
const BUILD='v3.4.2-microaudit-ai2';
const INSTANCE='__SHADOW_SLAVE_REMOTE_RUNTIME_V342__';

if(!HOST[INSTANCE]){
  HOST[INSTANCE]=true;
  HOST.ShadowSlaveRemoteRuntimeStatus={state:'BOOT',build:BUILD,base_url:new URL('.',import.meta.url).href,last_error:null};
  const load=async(rel)=>{const u=new URL(rel,import.meta.url);u.searchParams.set('v',BUILD);return await import(u.href);};
  HOST.ShadowSlaveRemoteRuntimeReady=(async()=>{
    try{
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_RULES';
      await load('./runtime/ShadowSlave_Gameplay_Rules_v34.js');
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_AUTODB';
      await load('./runtime/ShadowSlave_AutoDB_v3.js');
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_CANONDB';
      await load('./runtime/ShadowSlave_CanonDB_v3.js');
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_SAVE_BOOTSTRAP';
      await load('./runtime/ShadowSlave_Save_Bootstrap_v3.js');
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_VALIDATOR';
      await load('./runtime/ShadowSlave_Save_Validator_v3.js');
      HOST.ShadowSlaveRemoteRuntimeStatus.state='WAITING_CANON';
      if(!HOST.ShadowSlaveCanonDB?.ready)throw new Error('ShadowSlaveCanonDB API missing after module import');
      const canon=await HOST.ShadowSlaveCanonDB.ready();
      HOST.ShadowSlaveRemoteRuntimeStatus.state='LOADING_CANON_DIRECTOR';
      await load('./runtime/ShadowSlave_CanonDirector_v2.js');
      if(HOST.ShadowSlaveCanonDirectorReady)await HOST.ShadowSlaveCanonDirectorReady;
      HOST.ShadowSlaveRemoteRuntimeStatus.state='READY';
      HOST.ShadowSlaveRemoteRuntimeStatus.canon=canon;
      HOST.ShadowSlaveRemoteRuntimeStatus.canon_director=HOST.ShadowSlaveCanonDirector?.build||null;
      HOST.ShadowSlaveRemoteRuntimeStatus.ready_at=new Date().toISOString();
      console.log('[Shadow Slave v3.4.2] remote runtime READY',HOST.ShadowSlaveRemoteRuntimeStatus);
      return HOST.ShadowSlaveRemoteRuntimeStatus;
    }catch(e){
      HOST.ShadowSlaveRemoteRuntimeStatus.state='ERROR';
      HOST.ShadowSlaveRemoteRuntimeStatus.last_error=String(e?.stack||e?.message||e);
      console.error('[Shadow Slave v3.4.2] remote runtime failed',e);
      throw e;
    }
  })();
}
export const ready=HOST.ShadowSlaveRemoteRuntimeReady;
export const status=()=>HOST.ShadowSlaveRemoteRuntimeStatus;
