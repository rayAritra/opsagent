from pathlib import Path
import json
r=Path('.')
p=r/'packages/db/src/security.ts';s=p.read_text().replace("const [payload,sig]=token.split('.');const expected=", "const parts=token.split('.');if(parts.length!==2||! /^[a-zA-Z0-9_-]+$/.test(parts[0])||! /^[a-f0-9]{64}$/.test(parts[1]))return false;const [payload,sig]=parts;const expected=");p.write_text(s)
p=r/'.env';s=p.read_text();s+='\nPLAYWRIGHT_BROWSERS_PATH=C:/Users/imaritra/Desktop/new_job/playwright-browsers\n';p.write_text(s)
p=r/'package.json';d=json.loads(p.read_text());d['scripts']['test']='node --import dotenv/config node_modules/vitest/vitest.mjs run';d['scripts']['test:e2e']='node --import dotenv/config node_modules/playwright/cli.js test';d['scripts']['browser:install']='node --import dotenv/config node_modules/playwright/cli.js install chromium';p.write_text(json.dumps(d,indent=2))
