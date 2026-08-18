// Shadow Slave v3.3 remote runtime entrypoint.
const HOST=(typeof window!=='undefined')?(window.parent||window):globalThis;
const BUILD='v3.4-gameplay-correctness';
const INSTANCE='__SHADOW_SLAVE_REMOTE_RUNTIME_V34__';

if(!HOST[INSTANCE]){
  HOST[INSTANCE]=true;
  HOST.ShadowSlaveRemoteRuntimeStatus={
    state:'BOOT',
    build:BUILD,
    base_url:new URL('.',import.meta.url).href,
    last_error:null
  };

  const load=async(rel)=>{
    const u=new URL(rel,import.meta.url);
    u.searchParams.set('v',BUILD);
    return await import(u.href);
  };

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

      HOST.ShadowSlaveRemoteRuntimeStatus.state='READY';
      HOST.ShadowSlaveRemoteRuntimeStatus.canon=canon;
      HOST.ShadowSlaveRemoteRuntimeStatus.ready_at=new Date().toISOString();
      console.log('[Shadow Slave v3] remote runtime READY',HOST.ShadowSlaveRemoteRuntimeStatus);
      return HOST.ShadowSlaveRemoteRuntimeStatus;
    }catch(e){
      HOST.ShadowSlaveRemoteRuntimeStatus.state='ERROR';
      HOST.ShadowSlaveRemoteRuntimeStatus.last_error=String(e?.stack||e?.message||e);
      console.error('[Shadow Slave v3] remote runtime failed',e);
      throw e;
    }
  })();
}
export const ready=HOST.ShadowSlaveRemoteRuntimeReady;
export const status=()=>HOST.ShadowSlaveRemoteRuntimeStatus;
