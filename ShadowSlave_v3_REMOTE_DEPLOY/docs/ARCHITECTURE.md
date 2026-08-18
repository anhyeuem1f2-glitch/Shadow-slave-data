# Architecture

```text
LEAN CHARACTER CARD
  ├─ MVU / EJS / play-kernel lore
  ├─ Character Genesis / Regex
  └─ tiny Tavern Helper remote loader
          │
          ▼
PUBLIC CLOUDFLARE PAGES
  index.js
    ├─ AutoDB SAVE runtime
    ├─ CanonDB runtime
    ├─ SAVE bootstrap
    └─ SAVE validator
          │
          └── data/manifest.json
                    │
                    ▼
          canon.records.v3.jsonl.gz
          │
          ▼
LOCAL BROWSER
  ├─ IndexedDB ShadowSlave_RED_CanonDB_v3 (immutable canon)
  └─ AutoDB SS_RED_V3 (mutable SAVE/AM memory)
```
