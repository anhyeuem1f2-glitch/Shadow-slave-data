# Shadow Slave v3.3 — REMOTE DB DEPLOY

Push the CONTENTS of this folder to GitHub and deploy them with Cloudflare Pages.

## Actual database file

`data/canon.records.v3.jsonl.gz`

- 5,822 records
- compressed: 1.28 MiB
- decompressed: 17.53 MiB
- raw SHA-256: `b8e6e14c0002f4944ae590bc7793487d4ae643a7c642178a08345a5aa31b2cee`

`data/canon.records.v3.jsonl` is only a browser fallback.

## What the card loads

The card contains a tiny Tavern Helper loader only.

It imports:

`https://YOUR-DOMAIN/.../index.js`

Public `index.js` then loads:

- `runtime/ShadowSlave_AutoDB_v3.js`
- `runtime/ShadowSlave_CanonDB_v3.js`
- `runtime/ShadowSlave_Save_Bootstrap_v3.js`
- `runtime/ShadowSlave_Save_Validator_v3.js`

CanonDB then fetches:

`data/manifest.json` → `data/canon.records.v3.jsonl.gz`

and installs/reuses browser IndexedDB:

`ShadowSlave_RED_CanonDB_v3`

SAVE remains separate under AutoDB isolation:

`SS_RED_V3`

## Cloudflare Pages

1. Put these files in a GitHub repository.
2. Connect the repository to Cloudflare Pages.
3. No build command is required.
4. Confirm these public URLs work:
   - `/version.json`
   - `/data/manifest.json`
   - `/index.js`
5. Suppose your final URL is:
   `https://shadow-slave-db.pages.dev/index.js`
6. Patch the template card with:

```bash
python tools/configure_card_url.py   "(RED) Shadow Slave v3.3 REMOTE-DB TEMPLATE.json"   "https://shadow-slave-db.pages.dev/index.js"   "(RED) Shadow Slave.json"
```

After that, player UX is:

```text
Import card
→ tiny loader imports public index.js
→ remote runtime loads
→ CanonDB downloads only if local hash is missing/outdated
→ IndexedDB ready
→ play
```

No manual database import and no Python/FastAPI server are required for the player.
