#!/usr/bin/env python3
from pathlib import Path
import json, sys, re

if len(sys.argv) != 4:
    print("Usage: python configure_card_url.py <input_card.json> <public_index_js_url> <output_card.json>")
    raise SystemExit(2)

src=Path(sys.argv[1]); url=sys.argv[2].strip(); out=Path(sys.argv[3])
if not re.match(r"^https://.+/index\.js(?:\?.*)?$",url):
    raise SystemExit("URL must look like https://YOUR-DOMAIN/.../index.js")

card=json.loads(src.read_text(encoding="utf-8"))
scripts=card["data"]["extensions"]["tavern_helper"]["scripts"]
loader=next(x for x in scripts if x.get("name")=="Shadow Slave v3.3 · REMOTE Runtime Loader")
loader["content"]=re.sub(
    r"const REMOTE_RUNTIME_URL='[^']+';",
    "const REMOTE_RUNTIME_URL="+repr(url)+";",
    loader["content"],
    count=1
)
card["data"]["extensions"]["shadow_slave_v3"]["remote_runtime_url"]=url
out.write_text(json.dumps(card,ensure_ascii=False,indent=2),encoding="utf-8")
print(out)
