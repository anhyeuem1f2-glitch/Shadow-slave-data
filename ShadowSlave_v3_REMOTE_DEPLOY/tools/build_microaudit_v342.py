import json, re, os, gzip, hashlib, math, unicodedata, collections, pathlib, shutil, textwrap

SRC='/mnt/data/canon.records.v3.jsonl'
OUT='/mnt/data/v342_build/canon.records.v3.jsonl'
REPORT='/mnt/data/v342_build/MICROAUDIT_V342_REPORT.json'
pathlib.Path('/mnt/data/v342_build').mkdir(parents=True,exist_ok=True)

STOP=set('''the and for with from into this that these those then than when where what who whom whose why how was were are is be been being a an of to in on at by as or if but not no do does did done it its their there they them he she his her hers him you your yours we our ours i me my mine can could should would will may might must have has had having through during before after above below under over out up down off again further once here very only same so too just more most less each other some any all both few many much own such nor while because until against between about around across inside outside within without via per'''.split())
STOP |= set('''và là của có không một những các trong cho với đã được từ khi thì này đó như nhưng về ở ra vào trên dưới trước sau đang sẽ cũng rất hơn chỉ lại đến đi nếu vì theo qua giữa hoặc mỗi người mình cậu cô anh hắn họ nó ta tôi bạn user nhân vật chapter canon scene volume source state rule rules evidence current direct fulltext v v1 v2 v3 v4 v5 v6 v7 v8 v9 v10 v11 v12 ss shadow slave'''.split())

DIALOGUE_PATTERNS=[
 ('QUESTION',r'\b(hỏi|chất vấn|tự hỏi|ask(?:ed)?|question(?:ed)?)\b'),
 ('ANSWER',r'\b(trả lời|đáp|answer(?:ed)?|repl(?:y|ied))\b'),
 ('EXPLAIN',r'\b(giải thích|explain(?:ed)?)\b'),
 ('WARN',r'\b(cảnh báo|dặn|warn(?:ed)?|caution(?:ed)?)\b'),
 ('COMMAND',r'\b(ra lệnh|mệnh lệnh|command(?:ed)?|order(?:ed)?)\b'),
 ('PROPOSE',r'\b(đề nghị|đề xuất|offer(?:ed)?|propos(?:e|ed))\b'),
 ('REFUSE',r'\b(từ chối|refus(?:e|ed))\b'),
 ('ADMIT',r'\b(thú nhận|admit(?:ted)?)\b'),
 ('TEASE_OR_JOKE',r'\b(đùa|trêu|mỉa|sarcas|jok|teas)\w*\b'),
 ('TELL_OR_STATE',r'\b(nói|bảo|kể|gọi|tuyên bố|nhắc|say|said|tell|told|state(?:d)?|mention(?:ed)?)\b'),
]
THOUGHT_RE=re.compile(r'\b(nghĩ|nhận ra|nhận thấy|hiểu|muốn|nhớ|nghi|ngờ|đánh giá|quyết định|cho rằng|tin rằng|biết rằng|tự hỏi|cân nhắc|suy|realiz\w*|notice\w*|think\w*|thought|suspect\w*|decid\w*|remember\w*|understand\w*|want\w*|believ\w*|consider\w*)\b',re.I)
ACTION_RE=re.compile(r'\b(đi|đến|rời|chạy|bước|leo|nhảy|đánh|tấn công|giết|ném|nhặt|uống|ăn|ngồi|đứng|quay|cầm|đưa|kéo|đẩy|chặn|mở|đóng|mặc|đeo|kiểm tra|chạm|giữ|bảo vệ|chữa|trốn|ẩn|dùng|sử dụng|triệu hồi|né|đỡ|walk\w*|run\w*|step\w*|climb\w*|jump\w*|attack\w*|kill\w*|throw\w*|pick\w*|drink\w*|eat\w*|sit\w*|stand\w*|turn\w*|hold\w*|take\w*|give\w*|pull\w*|push\w*|block\w*|open\w*|close\w*|wear\w*|use\w*|summon\w*|dodge\w*|parry\w*)\b',re.I)
EMOTION_RE=re.compile(r'\b(sợ|lo|tức|giận|ghét|vui|xấu hổ|bối rối|đau|căng thẳng|bình tĩnh|cynical|fear\w*|angry|anger|hate\w*|amuse\w*|embarrass\w*|confus\w*|pain\w*|calm\w*|anxious|anxiety)\b',re.I)
KNOW_RE=re.compile(r'\b(biết|không biết|nhận ra|hiểu|knowledge|know\w*|learn\w*|discover\w*|reveal\w*)\b',re.I)
REL_RE=re.compile(r'\b(tin cậy|tin tưởng|thân|quan hệ|relationship|trust|betray\w*|ally|đồng đội|mentor|friend|romance|attachment|intimacy)\b',re.I)


def sha256_bytes(b):return hashlib.sha256(b).hexdigest()
def sha256_text(s):return sha256_bytes(s.encode('utf-8'))
def nrm(s):
    s=unicodedata.normalize('NFKD',str(s or ''))
    s=''.join(ch for ch in s if not unicodedata.combining(ch)).lower()
    s=re.sub(r'[^a-z0-9]+',' ',s)
    return re.sub(r'\s+',' ',s).strip()
def slug(s):return re.sub(r'[^A-Z0-9]+','_',nrm(s).upper()).strip('_')[:70]
def toks(s):
    return [t for t in nrm(s).split() if len(t)>=3 and t not in STOP and not t.isdigit()]
def parse_sections(text):
    out={}
    ms=list(re.finditer(r'^##\s+(.+?)\s*$',text or '',flags=re.M))
    for i,m in enumerate(ms):
        out[m.group(1).strip()]=(text[m.end():ms[i+1].start() if i+1<len(ms) else len(text)]).strip()
    return out
def sec_any(sec,*names):
    for n in names:
        if n in sec:return sec[n]
    # fuzzy exact normalized title
    nn={nrm(k):v for k,v in sec.items()}
    for n in names:
        if nrm(n) in nn:return nn[nrm(n)]
    return ''
def ev_status(text):
    m=re.search(r'<EvidenceQuality[^>]*status="([^"]+)"',text or '')
    return m.group(1) if m else None
def extract_scene_label(text):
    m=re.search(r'^SCENE_LABEL:\s*(.+)$',text or '',flags=re.M)
    return m.group(1).strip() if m else ''
def parse_numbered(text):
    units=[]
    for m in re.finditer(r'(?m)^\s*(\d+)\.\s+(.+?)(?=\n\s*\d+\.\s+|\Z)',text or '',flags=re.S):
        s=re.sub(r'\s+',' ',m.group(2)).strip()
        if s:units.append((int(m.group(1)),s))
    return units
def split_sentences(text):
    text=re.sub(r'\s+',' ',text or '').strip()
    if not text:return []
    # preserve reasonably meaningful units; semicolon often separates distinct micro-actions in this DB
    parts=re.split(r'(?<=[.!?])\s+|\s*;\s*',text)
    return [p.strip(' -\t') for p in parts if len(p.strip())>=18]
def detect_speech_act(s):
    # A rule description such as 'không thể nói dối' is not itself a dialogue event.
    if re.search(r'\b(không thể|cannot|can not)\s+nói dối\b',s,re.I) and not re.search(r'\b(hỏi|trả lời|đáp|giải thích|dặn|cảnh báo|ra lệnh|đề nghị|từ chối|thú nhận|bảo|kể|tuyên bố|ask|answer|reply|explain|warn|command|order|offer|refuse|admit|tell|said)\b',s,re.I):
        return None
    for lab,pat in DIALOGUE_PATTERNS:
        if re.search(pat,s,re.I):return lab
    return None

def parse_cast(text):
    if not text:return []
    text=re.sub(r'\([^)]*\)','',text)
    vals=[]
    for x in re.split(r',|;|\band\b|\bvà\b',text,flags=re.I):
        x=x.strip(' .-*\n\t')
        if 1<len(x)<=60 and not re.match(r'^(none|unknown|không|n/a)',x,re.I):vals.append(x)
    # stable unique
    seen=set();out=[]
    for x in vals:
        k=nrm(x)
        if k and k not in seen:seen.add(k);out.append(x)
    return out

FEMALE={nrm(x) for x in ['Nephis','Cassie','Effie','Jet','Rain','Saint','Seishan','Solvane','Hope','Morgan','Beastmaster','Tyris','Naeve']}; MALE={nrm(x) for x in ['Sunny','Kai','Mordret','Caster','Julius','Noctis','Shifty','Scholar','Hero','Elyas','Sevras']}
def subject_actor(unit,cast):
    st=unit.strip();nu=nrm(st)
    for a in cast:
        aa=nrm(a)
        if aa and (nu.startswith(aa+' ') or nu==aa):return a
    if re.match(r'^cậu\b',st,re.I) and any(nrm(a)=='sunny' for a in cast):return next(a for a in cast if nrm(a)=='sunny')
    if re.match(r'^cô\b',st,re.I):
        fs=[a for a in cast if nrm(a) in FEMALE]
        if len(fs)==1:return fs[0]
    if re.match(r'^(anh|hắn)\b',st,re.I):
        ms=[a for a in cast if nrm(a) in MALE]
        if len(ms)==1:return ms[0]
    return None
def actor_hits(unit,cast):
    u=' '+nrm(unit)+' ';hits=[]
    sub=subject_actor(unit,cast)
    if sub:hits.append(sub)
    for a in cast:
        aa=nrm(a)
        if aa and (' '+aa+' ' in u or (len(aa)>=5 and aa in nrm(unit))) and a not in hits:hits.append(a)
    return hits

def classify(unit,section):
    speech=detect_speech_act(unit)
    kinds=[]
    if speech:kinds.append('DIALOGUE_BEHAVIOR')
    if THOUGHT_RE.search(unit):kinds.append('COGNITION')
    if ACTION_RE.search(unit):kinds.append('PHYSICAL_ACTION')
    if EMOTION_RE.search(unit):kinds.append('EMOTION')
    if KNOW_RE.search(unit) or 'KNOWLEDGE' in section.upper():kinds.append('KNOWLEDGE')
    if REL_RE.search(unit) or 'RELATIONSHIP' in section.upper():kinds.append('RELATIONSHIP')
    if 'STATE' in section.upper():kinds.append('STATE_DELTA')
    if 'SYSTEM' in section.upper() or 'WORLD' in section.upper():kinds.append('WORLD_OR_MECHANIC')
    if not kinds:kinds=['EVENT_BEAT']
    return kinds,speech

def make_atom(prefix,num,unit,section,cast,authority,chapter=None,scene_label=''):
    kinds,speech=classify(unit,section)
    actors=actor_hits(unit,cast)
    return {
        'atom_id':f'{prefix}_{num:04d}',
        'kinds':kinds,
        'actors':actors,
        'subject_actor':subject_actor(unit,cast),
        'evidence_text':unit,
        'source_section':section,
        'chapter':chapter,
        'scene_label':scene_label or None,
        'authority':authority,
        'speech_act':speech,
        'exact_dialogue_wording_known':False,
        'generation_use':(
            'Speech-strategy evidence only; paraphrase, never reconstruct exact canon wording.' if speech else
            'Cognition may guide internal narration only when actor/POV is supported; otherwise keep as inference.' if 'COGNITION' in kinds else
            'Behavioral precedent, not mandatory choreography; recalculate under SAVE divergence.' if 'PHYSICAL_ACTION' in kinds else
            'Use only within the stated evidence ceiling.'
        )
    }

def chapter_microaudit(r):
    text=r.get('content',''); sec=parse_sections(text); status=ev_status(text) or r.get('evidence_quality') or 'UNKNOWN'
    cast=parse_cast(sec_any(sec,'CAST IN DIRECT EVIDENCE'))
    label=extract_scene_label(text)
    authority='DIRECT_FULLTEXT_PARAPHRASE' if status.startswith('A_') else ('PUBLIC_DIRECT_ANCHOR' if status.startswith('B_') else status)
    if status.startswith('A_'):audit_status='VERIFIED_RECORDED_EVIDENCE'
    elif status.startswith('B_'):audit_status='VERIFIED_PUBLIC_ANCHOR_ONLY'
    elif status.startswith('C_'):audit_status='SPARSE_ANCHOR_NO_LINE_LEVEL_MICRODETAIL'
    elif status.startswith('D_'):audit_status='RANGE_ONLY_NO_LINE_LEVEL_MICRODETAIL'
    elif status.startswith('E_'):audit_status='CATALOG_ONLY'
    else:audit_status='UNKNOWN'
    atoms=[]
    if status.startswith(('A_','B_')):
        source_sections=[]
        beats=sec_any(sec,'ORDERED SCENE / EVENT BEATS','ORDERED PUBLIC EVIDENCE BEATS','CURRENT CHAPTER EVENT / STATE','CHAPTER-SPECIFIC EVENT EXTRACTION','CHAPTER-SPECIFIC STATE / EVENT EXTRACTION')
        if beats:source_sections.append(('ORDERED_BEATS',beats))
        psych=sec_any(sec,'PSYCHOLOGY EVIDENCE','PSYCHOLOGY / BEHAVIOR','PSYCHOLOGY')
        if psych:source_sections.append(('PSYCHOLOGY_EVIDENCE',psych))
        state=sec_any(sec,'STATE DELTA / CARRYOVER','STATE DELTA','STATE PERSISTENCE')
        if state:source_sections.append(('STATE_DELTA',state))
        know=sec_any(sec,'KNOWLEDGE FIREWALL','FIREWALL')
        if know:source_sections.append(('KNOWLEDGE_FIREWALL',know))
        rel=sec_any(sec,'RELATIONSHIP DELTA')
        if rel:source_sections.append(('RELATIONSHIP_DELTA',rel))
        world=sec_any(sec,'SYSTEM / WORLD EVIDENCE','SYSTEM / WORLD DELTA')
        if world:source_sections.append(('SYSTEM_WORLD',world))
        n=1
        for st,body in source_sections:
            numbered=parse_numbered(body)
            units=[]
            if numbered:
                for _,u in numbered: units.extend(split_sentences(u) or [u])
            else: units=split_sentences(body)
            for u in units:
                atoms.append(make_atom(f'CH{int(r.get("chapter_start") or 0):04d}',n,u,st,cast,authority,int(r.get('chapter_start') or 0),label));n+=1
    # explicit no-overreach rules
    constraints=[]
    sr=sec_any(sec,'SOURCE USE RULE','KNOWLEDGE FIREWALL','CAUSAL LOCK','BUTTERFLY','TIME-FIRST / BUTTERFLY RULE')
    if sr:
        constraints=[x for x in split_sentences(sr)[:12]]
    actor_index=sorted({a for a in cast}|{a for at in atoms for a in at['actors']})
    return {
        'schema':'ss-microaudit-v1',
        'status':audit_status,
        'evidence_tier':status,
        'source_tier':r.get('source_tier'),
        'chapter':r.get('chapter_start'),
        'scene_label':label or None,
        'cast':cast,
        'location':sec_any(sec,'LOCATION') or None,
        'canon_clock':sec_any(sec,'CANON CLOCK','TIME CONTEXT') or None,
        'behavior_atoms':atoms,
        'actor_index':actor_index,
        'generation_constraints':constraints,
        'line_level_source_reaudit_needed':True,
        'verbatim_dialogue_coverage':False,
        'note':'Atoms are derived only from existing structured evidence. They do not reconstruct omitted source dialogue or private thought.'
    }

def scene_microaudit(r):
    text=r.get('content','');sec=parse_sections(text)
    source=sec_any(sec,'SOURCE RANGE')
    detailed=sec_any(sec,'DETAILED SCENE MODEL','CURRENT EVIDENCE','ACTIVE RANGE MODEL')
    # detect source authority from the source note
    sn=nrm(source)
    direct=('official webnovel public text' in sn or 'fulltext' in sn or 'full text' in sn or 'direct' in sn)
    authority='DIRECT_SCENE_PARAPHRASE' if direct else 'STRUCTURED_SCENE_EVIDENCE'
    # actors from title/profile references and explicit names in detailed; use known common list later augmented externally
    cast=[]
    atoms=[];n=1
    for u in split_sentences(detailed):
        atoms.append(make_atom('SCENE_'+slug(r.get('record_id','')),n,u,'DETAILED_SCENE_MODEL',cast,authority,r.get('chapter_start'),r.get('name')));n+=1
    return {
        'schema':'ss-microaudit-v1','status':'VERIFIED_RECORDED_SCENE_EVIDENCE' if direct else 'STRUCTURED_SCENE_EVIDENCE',
        'source_range':source or None,'behavior_atoms':atoms,'actor_index':[],
        'line_level_source_reaudit_needed':True,'verbatim_dialogue_coverage':False,
        'note':'Scene atoms preserve only claims already present in the structured scene record.'
    }

def char_director(r):
    text=r.get('content',''); sec=parse_sections(text)
    def vals(*names):
        x=sec_any(sec,*names);return [s for s in split_sentences(x)[:18]]
    # EVID blocks
    evs=[]
    pattern=re.compile(r'^###\s+(EVID-[^\n]+)\n([\s\S]*?)(?=^###\s+EVID-|^##\s+|\Z)',re.M)
    for i,m in enumerate(pattern.finditer(text),1):
        title=m.group(1).strip();body=m.group(2)
        obs=re.search(r'\*\*Quan sát trực tiếp / scene fact:\*\*\s*(.+)',body)
        allow=re.search(r'\*\*Đọc tâm lý được phép:\*\*\s*(.+)',body)
        forbid=re.search(r'\*\*Không được suy quá:\*\*\s*(.+)',body)
        evs.append({
            'atom_id':f'CHAR_{slug(r.get("name"))}_EVID_{i:03d}',
            'anchor':title,
            'observation':obs.group(1).strip() if obs else re.sub(r'\s+',' ',body).strip()[:900],
            'allowed_inference':allow.group(1).strip() if allow else None,
            'forbidden_overreach':forbid.group(1).strip() if forbid else None,
            'authority':'DIRECT_SCENE_PSYCHOLOGY_EVIDENCE'
        })
    hard=vals('Cấm viết sai','CẤM','Những thứ không được tự bịa để làm profile có vẻ dài')
    return {
        'schema':'ss-character-director-v1',
        'voice':vals('Voice model','Voice / social presentation','Cách nói chuyện & xưng hô'),
        'body_language':vals('Ấn tượng cơ thể, movement và body language','Ngoại hình & khí chất'),
        'decision_model':vals('Decision model','Value core & moving psychology','VALUE CORE'),
        'emotional_model':vals('Emotional model','ACTIVE WOUND / TRIGGER','ATTACHMENT STYLE'),
        'knowledge_partition':vals('Knowledge partition','Knowledge firewall','Tri thức được phép biết'),
        'social_behavior':vals('Social behavior'),
        'combat_model':vals('Combat decision tree','Năng lực & phong cách chiến đấu đúng giai đoạn'),
        'relationship_user':vals('RELATIONSHIP WITH {user}','Relationship with {user}','Tiến triển khi gặp {{user}}'),
        'hard_do_not':hard,
        'direct_evidence_atoms':evs,
        'line_level_source_reaudit_needed':True,
    }

# Load
records=[]
with open(SRC,'r',encoding='utf-8') as f:
    for ln,line in enumerate(f,1):
        try:records.append(json.loads(line))
        except Exception as e:raise RuntimeError(f'JSON error line {ln}: {e}')

# Character aliases from temporal profiles
char_aliases=collections.defaultdict(set)
for r in records:
    if r.get('category')!='CANON_CHARACTER_TEMPORAL':continue
    m=re.match(r'^SS \| NHÂN VẬT \| (.+?) \| V\d+',r.get('name',''),re.I)
    canonical=m.group(1).strip() if m else r.get('name','')
    char_aliases[canonical].add(canonical)
    # first markdown title in Character_Version
    cm=re.search(r'<Character_Version>\s*\n#\s+([^\n]+)',r.get('content',''),re.I)
    if cm:
        title=re.sub(r'\s+—.*$','',cm.group(1)).strip()
        for a in re.split(r'\s*/\s*|\s+\|\s+',title):
            a=a.strip()
            if 2<=len(a)<=60:char_aliases[canonical].add(a)
# manual high-confidence common aliases already canon-visible in database names/content
manual={
 'Sunny':['Sunless','Lost from Light'], 'Nephis':['Changing Star'], 'Cassie':['Song of the Fallen'],
 'Kai':['Nightingale'], 'Effie':['Raised by Wolves'], 'Jet':['Soul Reaper'], 'Mordret':['Prince of Nothing']
}
for k,v in manual.items():char_aliases[k].update(v)
all_alias_pairs=[]
for c,als in char_aliases.items():
    for a in als:
        if len(nrm(a))>=4:all_alias_pairs.append((a,c))
all_alias_pairs=sorted(all_alias_pairs,key=lambda x:len(nrm(x[0])),reverse=True)

# first pass DF using limited normalized tokens
DF=collections.Counter(); token_counters=[]
for r in records:
    basis=' '.join([r.get('name',''),' '.join(r.get('keys') or []),r.get('content','')])
    tc=collections.Counter(toks(basis))
    token_counters.append(tc)
    DF.update(tc.keys())
N=len(records)

stats=collections.Counter(); tier_counts=collections.Counter(); actor_atom_counts=collections.Counter(); kind_counts=collections.Counter();
new_records=[]
for idx,r0 in enumerate(records):
    r=dict(r0)
    content=r.get('content',''); cat=r.get('category',''); sec=parse_sections(content)
    # aliases from record title
    aliases=[]
    name=r.get('name','')
    parts=[p.strip() for p in name.split('|')]
    if len(parts)>=3:
        tail=parts[-1] if not re.fullmatch(r'V\d+',parts[-1],re.I) else (parts[-2] if len(parts)>=2 else '')
        if tail and not tail.upper().startswith('CH '):aliases.append(tail)
    # character-specific aliases
    if cat=='CANON_CHARACTER_TEMPORAL':
        m=re.match(r'^SS \| NHÂN VẬT \| (.+?) \| V\d+',name,re.I);canonical=m.group(1).strip() if m else ''
        aliases.extend(sorted(char_aliases.get(canonical,[])))
    # actor index source-first
    actors=[]
    if cat=='CANON_CHAPTER_EVIDENCE':
        micro=chapter_microaudit(r);r['microaudit_v1']=micro;actors=micro['actor_index'];tier_counts[micro['evidence_tier']]+=1
    elif cat=='CANON_SCENE_EVIDENCE' and r.get('subtype')=='deep_scene':
        micro=scene_microaudit(r)
        # Detect named character aliases in scene text, high confidence only
        nt=' '+nrm(content)+' '
        found=[]
        for a,c in all_alias_pairs:
            na=nrm(a)
            if (' '+na+' ' in nt) and c not in found:found.append(c)
        micro['actor_index']=found[:20]
        for at in micro['behavior_atoms']:
            if not at['actors']:
                hits=actor_hits(at['evidence_text'],found)
                at['actors']=hits
        r['microaudit_v1']=micro;actors=micro['actor_index']
    elif cat=='CANON_CHARACTER_TEMPORAL':
        director=char_director(r);r['character_director_v1']=director
        m=re.match(r'^SS \| NHÂN VẬT \| (.+?) \| V\d+',name,re.I);actors=[m.group(1).strip()] if m else []
    # actors for other relevant records via alias mentions (cap) only if narrative authority
    if not actors and cat in {'CANON_MECHANIC','CANON_LOCATION','CANON_WORLD','CANON_EVENT','CANON_FACTION'}:
        nt=' '+nrm((name+' '+content[:12000]))+' '
        found=[]
        for a,c in all_alias_pairs:
            na=nrm(a)
            if (' '+na+' ' in nt) and c not in found:found.append(c)
        actors=found[:12]
    # retrieval tf-idf terms
    tc=token_counters[idx]
    scored=[]
    for t,tf in tc.items():
        idf=math.log((N+1)/(DF[t]+1))+1.0
        # saturating tf
        score=(1+math.log(tf))*idf
        if t in {'sunny','nephis','cassie','mordret','effie','kai','jet'}:score*=1.15
        scored.append((score,t))
    terms=[t for _,t in sorted(scored,reverse=True)[:28]]
    # entity aliases actually mentioned
    entities=[];nt=' '+nrm((name+' '+content[:18000]))+' '
    seen_c=set()
    for a,c in all_alias_pairs:
        na=nrm(a)
        if c in seen_c:continue
        if ' '+na+' ' in nt:
            entities.append({'name':c,'matched_alias':a,'type':'CHARACTER'});seen_c.add(c)
        if len(entities)>=16:break
    evidence=ev_status(content) or r.get('evidence_quality')
    tags=[cat,r.get('subtype') or '',f'V{r.get("volume")}' if r.get('volume') else '',evidence or '',r.get('source_tier') or '']
    tags=[x for x in tags if x]
    # stable unique aliases
    aseen=set();aliases2=[]
    for a in aliases:
        k=nrm(a)
        if k and k not in aseen:aseen.add(k);aliases2.append(a)
    r['schema_version']='3.4.2-microaudit-ai2'
    r['retrieval_v5']={
        'aliases':aliases2[:16], 'tags':tags[:16], 'actors':actors[:20], 'entities':entities,
        'terms':terms, 'match_fields':['name','keys','aliases','tags','actors','entities','terms','microaudit']
    }
    r['authority_v5']={
        'original_canon_only':True,'save_is_separate':True,'index_only_is_not_narrative':bool(r.get('router_only')),
        'microdetail_ceiling':evidence or r.get('detail_authority') or 'UNSPECIFIED',
        'line_level_source_reaudit_needed':bool(r.get('microaudit_v1',{}).get('line_level_source_reaudit_needed') or r.get('character_director_v1',{}).get('line_level_source_reaudit_needed'))
    }
    # counts
    atoms=[]
    if 'microaudit_v1' in r:atoms += r['microaudit_v1'].get('behavior_atoms',[])
    if 'character_director_v1' in r:atoms += r['character_director_v1'].get('direct_evidence_atoms',[])
    for at in atoms:
        for k in at.get('kinds',[]) if isinstance(at,dict) else []:kind_counts[k]+=1
        for a in at.get('actors',[]) if isinstance(at,dict) else []:actor_atom_counts[a]+=1
    stats['behavior_atoms']+=len(atoms)
    if 'microaudit_v1' in r:stats['microaudit_records']+=1
    if 'character_director_v1' in r:stats['character_director_profiles']+=1;stats['direct_psychology_evidence_atoms']+=len(r['character_director_v1']['direct_evidence_atoms'])
    stats['retrieval_v5_records']+=1
    # record hash excludes itself
    tmp=json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':'))
    r['record_v5_sha256']=sha256_text(tmp)
    new_records.append(r)

# Write raw exactly one JSON per line
with open(OUT,'w',encoding='utf-8',newline='\n') as f:
    for r in new_records:f.write(json.dumps(r,ensure_ascii=False,separators=(',',':'))+'\n')
raw=open(OUT,'rb').read();raw_sha=sha256_bytes(raw)
GZ=OUT+'.gz'
with gzip.open(GZ,'wb',compresslevel=9,mtime=0) if False else open(os.devnull,'wb') as _dummy:
    pass
# Python gzip.open has no mtime param in some versions: deterministic via GzipFile
with open(GZ,'wb') as fout:
    with gzip.GzipFile(filename='',mode='wb',fileobj=fout,compresslevel=9,mtime=0) as gz:gz.write(raw)
gzb=open(GZ,'rb').read();gz_sha=sha256_bytes(gzb)

# integrity
orig_content={r['record_id']:r.get('content_sha256') for r in records}
content_mismatch=[]
for r in new_records:
    if orig_content[r['record_id']]!=r.get('content_sha256'):content_mismatch.append(r['record_id'])
ids=[r['record_id'] for r in new_records];keys=[k for r in new_records for k in (r.get('keys') or [])]
report={
 'build':'v3.4.2-microaudit-ai2',
 'records':len(new_records),'raw_bytes':len(raw),'raw_sha256':raw_sha,'gzip_bytes':len(gzb),'gzip_sha256':gz_sha,
 'original_raw_bytes':os.path.getsize(SRC),'growth_percent':round((len(raw)/os.path.getsize(SRC)-1)*100,2),
 'retrieval_v5_records':stats['retrieval_v5_records'],'microaudit_records':stats['microaudit_records'],
 'character_director_profiles':stats['character_director_profiles'],'behavior_atoms_total':stats['behavior_atoms'],
 'direct_psychology_evidence_atoms':stats['direct_psychology_evidence_atoms'],
 'atom_kind_counts':dict(kind_counts.most_common()),'top_actor_atom_counts':dict(actor_atom_counts.most_common(30)),
 'chapter_evidence_tiers':dict(tier_counts),
 'integrity':{
   'json_records_ok':len(new_records)==5822,
   'duplicate_record_ids':len(ids)-len(set(ids)),
   'duplicate_keys':len(keys)-len(set(keys)),
   'original_content_sha256_fields_changed':len(content_mismatch),
   'content_hash_mismatch_ids':content_mismatch[:20]
 },
 'fidelity_contract':{
   'exact_dialogue_reconstruction':False,
   'private_thought_reconstruction_without_direct_evidence':False,
   'line_level_source_reaudit_needed':True,
   'a_tier_atoms_use':'direct paraphrased evidence',
   'b_tier_atoms_use':'public direct anchor only',
   'cde_microdetail':'not fabricated'
 }
}
with open(REPORT,'w',encoding='utf-8') as f:json.dump(report,f,ensure_ascii=False,indent=2)
print(json.dumps(report,ensure_ascii=False,indent=2))
