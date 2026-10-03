from pathlib import Path
import json
r=Path('opsagent-ts')
p=r/'package.json';d=json.loads(p.read_text(encoding='utf8'));d['packageManager']='npm@11.16.0';d['workspaces']=['apps/*','packages/*'];p.write_text(json.dumps(d,indent=2))
for p in list(r.glob('apps/*/package.json'))+list(r.glob('packages/*/package.json')):
 d=json.loads(p.read_text(encoding='utf8'));d['dependencies']={k:('*' if v=='workspace:*' else v) for k,v in d['dependencies'].items()};p.write_text(json.dumps(d,indent=2))
for p in list(r.rglob('*.ts'))+list(r.rglob('*.tsx'))+list(r.rglob('*.md')):
 text=p.read_text(encoding='utf8');text=text.replace('pnpm ', 'npm run ').replace('pnpm-workspace.yaml','turbo.json');p.write_text(text,encoding='utf8')
p=r/'scripts/env.ts';s=p.read_text(encoding='utf8').replace("export const pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm';","export const npm=process.platform==='win32'?'npm.cmd':'npm';");p.write_text(s,encoding='utf8')
p=r/'scripts/setup.ts';s=p.read_text(encoding='utf8').replace('import {pnpm}', 'import {npm}').replace('spawnSync(pnpm','spawnSync(npm').replace("command(['install','--frozen-lockfile'])","command(['install'])").replace("command(['exec','playwright','install','chromium'])","command(['exec','--','playwright','install','chromium'])").replace("spawn(pnpm,['db:local']","spawn(npm,['run','db:local']").replace("command(['db:migrate'])","command(['run','db:migrate'])").replace("command(['seed'])","command(['run','seed'])").replace('npm run setup --local-db','npm run setup -- --local-db').replace('npm run dev --local-db','npm run dev -- --local-db');p.write_text(s,encoding='utf8')
p=r/'scripts/dev.ts';s=p.read_text(encoding='utf8').replace('import {pnpm}', 'import {npm}').replace('spawn(pnpm','spawn(npm').replace("start(['db:local'])","start(['run','db:local'])").replace("start(['--filter',`@opsagent/${app}`,'dev'])","start(['run','dev','--workspace',`@opsagent/${app}`])");p.write_text(s,encoding='utf8')
p=r/'docs/DECISIONS.md';p.write_text(p.read_text(encoding='utf8')+ '\n## Package manager override\nThe user explicitly requested npm. npm workspaces and package-lock.json replace pnpm workspaces/lockfile. Turborepo is retained. This user instruction takes precedence over the pasted stack requirement. The previous pnpm installation rejection is respected.\n')

