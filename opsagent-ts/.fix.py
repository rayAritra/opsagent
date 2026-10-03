from pathlib import Path
import json
r=Path('.')
p=r/'package.json';d=json.loads(p.read_text());d['devDependencies']['vitest']='^4.1.11';d['overrides']={'postcss':'^8.5.28'};d['allowScripts']={'esbuild':True,'embedded-postgres':True};d['scripts']['setup']='tsx scripts/setup.ts';d['scripts']['dev']='tsx scripts/dev.ts';p.write_text(json.dumps(d,indent=2))
p=r/'packages/db/package.json';d=json.loads(p.read_text());d['dependencies']['drizzle-orm']='^0.45.3';p.write_text(json.dumps(d,indent=2))
p=r/'packages/core/src/runtime.ts';s=p.read_text();s=s.replace("import {boundaryPrompt,untrusted}","import {boundaryPrompt}");s=s.replace("const form=browser.page!.locator('form[data-operation]').filter({has:browser.page!.locator('button')});const target=form.locator(`[name]`);",'');s=s.replace("const input=target.filter({has:browser.page!.locator(':scope')});void input;",'');p.write_text(s)
p=r/'packages/core/src/browser.ts';s=p.read_text().replace('mkdir,writeFile,readFile','mkdir,readFile');p.write_text(s)
