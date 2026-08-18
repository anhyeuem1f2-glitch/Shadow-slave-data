// Shadow Slave v3.4 — shared gameplay correctness rules
(function(){
'use strict';
const HOST=(typeof window!=='undefined')?(window.parent||window):globalThis;
const INSTANCE='__SHADOW_SLAVE_V34_RULES__';
if(HOST[INSTANCE])return;HOST[INSTANCE]=true;
const FN_STATES=['INACTIVE','COUNTDOWN','ENTERING','ACTIVE','FAILED','APPRAISAL','COMPLETED'];
const FN_ALLOWED={
  INACTIVE:new Set(['INACTIVE','COUNTDOWN','COMPLETED']),
  COUNTDOWN:new Set(['COUNTDOWN','ENTERING']),
  ENTERING:new Set(['ENTERING','ACTIVE','FAILED']),
  ACTIVE:new Set(['ACTIVE','FAILED','APPRAISAL']),
  FAILED:new Set(['FAILED']),
  APPRAISAL:new Set(['APPRAISAL','COMPLETED']),
  COMPLETED:new Set(['COMPLETED'])
};
const RULE_TYPES=new Set(['ACTION_PROHIBITION','ACTION_REQUIREMENT','SPEECH_PROHIBITION','ITEM_RESTRICTION','ABILITY_COST','STATE_PENALTY','CUSTOM_CONSTRAINT']);
const ALLOW_UNEARNED=new Set(['self_earned','earned','loot','looted','crafted','self_crafted','spell_reward','nightmare_reward','hunt_reward','discovered','claimed_from_defeated_enemy','self_found']);
const BLOCK_UNEARNED=new Set(['purchased','bought','gift','gifted','borrowed','loan','transferred','inherited']);
function text(x){return String(x??'').trim();}
function norm(x){return text(x).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\s-]+/g,'_');}
function arr(x){if(Array.isArray(x))return x.filter(Boolean).map(String);return text(x)?text(x).split(/[\n,;|]+/).map(s=>s.trim()).filter(Boolean):[];}
function bool(x,d=false){if(typeof x==='boolean')return x;const n=norm(x);if(['true','yes','1','on','active'].includes(n))return true;if(['false','no','0','off','inactive'].includes(n))return false;return d;}
function inferRuleType(desc){const n=norm(desc);
  if(/khong_the_su_dung.*(do|vat|item)|cannot_use.*item|must_personally_earn/.test(n))return 'ITEM_RESTRICTION';
  if(/khong_the_noi_doi|cannot_lie|cannot_tell.*lie|no_lies/.test(n))return 'SPEECH_PROHIBITION';
  if(/moi_lan.*(ability|nang_luc).*(mat|ton|cost)|ability.*cost/.test(n))return 'ABILITY_COST';
  if(/khong_the|cannot|forbidden|cam_/.test(n))return 'ACTION_PROHIBITION';
  if(/bat_buoc|must_|required/.test(n))return 'ACTION_REQUIREMENT';
  return 'CUSTOM_CONSTRAINT';
}
function normalizeFlawRule(raw={}){
  const desc=text(raw.Description||raw.description||raw['Mô_tả']||raw['Mô tả']||'');
  let type=text(raw.Type||raw.type||raw['Loại']||'').toUpperCase().replace(/[\s-]+/g,'_');
  if(!RULE_TYPES.has(type))type=inferRuleType(desc);
  const id=text(raw.ID||raw.id||raw['Rule ID']||raw.rule_id||'FLAW_PLAYER_001');
  return {
    ID:id,Name:text(raw.Name||raw.name||raw['Tên']||'Custom Flaw'),Description:desc,
    Type:type,State:text(raw.State||raw.state||'ACTIVE').toUpperCase(),
    Trigger:{Events:arr(raw.Trigger?.Events||raw.trigger_events||raw['Trigger Events'])},
    Condition:{Expression:text(raw.Condition?.Expression||raw.condition||raw['Condition'])},
    Constraint:{Required_Actions:arr(raw.Constraint?.Required_Actions||raw.required_actions||raw['Required Actions']),Forbidden_Actions:arr(raw.Constraint?.Forbidden_Actions||raw.forbidden_actions||raw['Forbidden Actions'])},
    Consequence:{Type:text(raw.Consequence?.Type||raw.consequence_type||raw['Consequence Type']||'BLOCK_ACTION').toUpperCase(),Effect:text(raw.Consequence?.Effect||raw.consequence_effect||raw['Consequence Effect'])},
    Planning:{Avoid_Goals:arr(raw.Planning?.Avoid_Goals||raw.planning_avoid||raw['Planning Avoid Goals']),Required_Considerations:arr(raw.Planning?.Required_Considerations||raw.planning_required||raw['Planning Required Considerations'])},
    Narrative:{Observable_Effect:text(raw.Narrative?.Observable_Effect||raw.observable_effect||raw['Narrative Observable Effect']),Internal_Effect:text(raw.Narrative?.Internal_Effect||raw.internal_effect||raw['Narrative Internal Effect'])},
    Exceptions:arr(raw.Exceptions||raw.exceptions),
    Enforcement:{Pre_Generation:bool(raw.Enforcement?.Pre_Generation??raw.pre_generation,true),Post_Generation:bool(raw.Enforcement?.Post_Generation??raw.post_generation,true)},
    Parameters:{Allowed_Acquisition_Methods:arr(raw.Parameters?.Allowed_Acquisition_Methods||raw.allowed_acquisition_methods),Cost_Resource:text(raw.Parameters?.Cost_Resource||raw.cost_resource),Cost_Amount:Number(raw.Parameters?.Cost_Amount??raw.cost_amount)||0},
    Provenance:{Source:text(raw.Provenance?.Source||raw.provenance||'USER_GENESIS')}
  };
}
function allowedNightmareTransition(from,to,ctx={}){
  from=text(from||'INACTIVE').toUpperCase();to=text(to||from).toUpperCase();
  if(!FN_STATES.includes(from)||!FN_STATES.includes(to))return {ok:false,reason:'unknown_state'};
  if(!FN_ALLOWED[from].has(to))return {ok:false,reason:`illegal_transition:${from}->${to}`};
  if(from==='ACTIVE'&&to==='APPRAISAL'&&!ctx.successConfirmed)return {ok:false,reason:'success_not_confirmed'};
  if(from==='APPRAISAL'&&to==='COMPLETED'&&!ctx.appraisalCommitted)return {ok:false,reason:'appraisal_not_committed'};
  return {ok:true,reason:'allowed'};
}
function isFirstNightmareLive(state){const s=text(state).toUpperCase();return ['COUNTDOWN','ENTERING','ACTIVE','APPRAISAL'].includes(s);}
function blueprintMustBeHidden(state){return ['INACTIVE','COUNTDOWN','ENTERING','ACTIVE','FAILED'].includes(text(state).toUpperCase());}
function evaluateFlawIntent(rule,userText,context={}){
  rule=normalizeFlawRule(rule);const u=text(userText),n=norm(u);const out={rule_id:rule.ID,type:rule.Type,matched:false,hard_block:false,planning_constraint:false,reasons:[],alternatives:[]};
  if(rule.State!=='ACTIVE')return out;
  if(rule.Type==='ITEM_RESTRICTION'){
    const acquire=/(mua|buy|purchase|purchased|được tặng|duoc tang|gift|gifted|mượn|muon|borrow|borrowed|nhận|nhan|receive|transfer)/i.test(u);
    const use=/(dùng|dung|use|equip|trang bị|trang bi|activate|kích hoạt|kich hoat|wield|cầm|cam)/i.test(u);
    if(acquire){out.matched=true;out.planning_constraint=true;out.reasons.push('Item acquisition path may be incompatible with active Flaw for personal use.');}
    if(acquire&&use){out.hard_block=true;out.reasons.push('Attempt combines an unearned acquisition path with immediate use/equip.');}
    if(context.itemBlocked){out.matched=true;out.hard_block=true;out.reasons.push('Named item is already blocked/unusable in validated SAVE.');}
    out.alternatives=['carry_without_using','give_away','sell','find_or_earn_legal_item'];
  }else if(rule.Type==='SPEECH_PROHIBITION'){
    if(/(^|\s)(nói|noi|tell|say|trả lời|tra loi|claim|answer|bảo|bao)\b/i.test(u)||/[“\"']/.test(u)){out.matched=true;out.planning_constraint=true;out.reasons.push('Speech intent must be checked against the active speech Flaw before utterance.');out.alternatives=['silence','refuse','omit','technically_true_wording'];}
  }else if(rule.Type==='ABILITY_COST'){
    if(/\b(dùng|dung|use|activate|kích hoạt|kich hoat).*(ability|năng lực|nang luc|skill|kỹ năng|ky nang)\b/i.test(u)){out.matched=true;out.planning_constraint=true;const amt=rule.Parameters.Cost_Amount||0,res=rule.Parameters.Cost_Resource||'declared cost';if(amt>0&&Number(context.availableResource)>=0&&Number(context.availableResource)<amt){out.hard_block=true;out.reasons.push(`Insufficient ${res} for Flaw cost ${amt}.`);}else out.reasons.push(`Ability use must pay Flaw cost: ${amt||''} ${res}`.trim());}
  }else{
    // For custom/action/state rules we cannot prove semantic violation in code, but we never drop them.
    out.matched=true;out.planning_constraint=true;out.reasons.push('Active custom Flaw must be evaluated against the intended action before resolution.');
  }
  return out;
}
function compileFlawPacket(rule,evalResult){rule=normalizeFlawRule(rule);evalResult=evalResult||evaluateFlawIntent(rule,'');
  return `<ACTIVE_FLAW_CONSTRAINT id="${rule.ID}" type="${rule.Type}" hard_block="${evalResult.hard_block?'true':'false'}">\nNAME: ${rule.Name}\nRULE: ${rule.Description||rule.Condition.Expression||'(structured custom constraint)'}\nTRIGGERS: ${rule.Trigger.Events.join(', ')||'state/action dependent'}\nFORBIDDEN: ${rule.Constraint.Forbidden_Actions.join(', ')||'see rule'}\nREQUIRED: ${rule.Constraint.Required_Actions.join(', ')||'none'}\nCONSEQUENCE: ${rule.Consequence.Type}${rule.Consequence.Effect?': '+rule.Consequence.Effect:''}\nPLANNING: ${[...rule.Planning.Avoid_Goals,...rule.Planning.Required_Considerations].join('; ')||'respect the Flaw before choosing/resolving actions'}\nINSTRUCTION: Evaluate this Flaw before resolving the user action. If the action violates it, do not narrate successful completion. Preserve legal alternatives. Do not reveal the Flaw to NPCs unless they have a valid information path.\n</ACTIVE_FLAW_CONSTRAINT>`;
}
function compileFirstNightmarePacket(nm={},player={}){const state=text(nm.State||'INACTIVE').toUpperCase();const vessel=nm.Vessel||{},obj=nm.Objective||{},spell=nm.Spell||{};
  return `<FIRST_NIGHTMARE_RUNTIME>\nTYPE: FIRST_NIGHTMARE\nSTATE: ${state}\nPLAYER_LIVE_RANK: ${text(player.rank||player.Rank||'Mundane')}\nLIVE_ASPECT_STATE: ${text(player.aspect_state||'UNAWAKENED')}\nLIVE_FLAW_STATE: ${text(player.flaw_state||'UNREVEALED')}\nTRUE_NAME_STATE: ${text(player.true_name_state||'UNREVEALED')}\nVESSEL_ROLE: ${text(vessel.Role||vessel.role||'UNASSIGNED')}\nVESSEL_BODY: ${text(vessel.Body_State||vessel.body_state||'UNKNOWN')}\nVESSEL_NATIVE_ABILITIES: ${arr(vessel.Native_Abilities||vessel.native_abilities).join(', ')||'none established'}\nOBJECTIVE_VISIBLE: ${text(obj.Visible||obj.visible||'not yet established')}\nSUCCESS_CONFIRMED: ${String(Boolean(obj.Success_Confirmed||obj.success_confirmed))}\nAPPRAISAL_STATE: ${text(spell.Appraisal_State||spell.appraisal_state||'NOT_STARTED')}\nSTRICT RULES:\n- This is a First Nightmare trial, not ordinary Dream Realm travel.\n- GenesisBlueprint is future design data and is not a current power source before a valid Appraisal reveal.\n- During COUNTDOWN/ENTERING/ACTIVE, future Aspect/Flaw/True Name/Abilities remain unavailable.\n- Do not copy Sunny's First Nightmare scenario, actors, Mountain King, slave caravan, or choreography unless the current SAVE explicitly places the player in that canon event.\n- The player's trial is independent simulation constrained by First Nightmare mechanics.\n- Rewards/progression require success, Appraisal, provenance, and validation.\n- Local actors do not automatically know they are inside a Nightmare.\n</FIRST_NIGHTMARE_RUNTIME>`;
}
HOST.ShadowSlaveV34Rules={
  build:'v3.4-gameplay-correctness',FN_STATES,RULE_TYPES,ALLOW_UNEARNED,BLOCK_UNEARNED,
  normalizeFlawRule,allowedNightmareTransition,isFirstNightmareLive,blueprintMustBeHidden,
  evaluateFlawIntent,compileFlawPacket,compileFirstNightmarePacket,norm,arr
};
})();
