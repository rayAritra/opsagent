from pathlib import Path
import json
r=Path('.')
for p in list(r.glob('scripts/*'))+list(r.glob('docs/*.md')):
 if not p.is_file():continue
 try:s=p.read_text(encoding='utf8')
 except UnicodeDecodeError:s=p.read_text(encoding='cp1252')
 s=s.removeprefix('\ufeff').removeprefix('\u00ef\u00bb\u00bf');p.write_text(s,encoding='utf8')
p=r/'package.json';d=json.loads(p.read_text());d['devDependencies']['turbo']='2.11.6';d['scripts']['typecheck']='tsc --noEmit --project tsconfig.json && turbo typecheck';p.write_text(json.dumps(d,indent=2))
p=r/'.env.example';s=p.read_text();s+='PLAYWRIGHT_BROWSERS_PATH=.local/browsers\n';p.write_text(s)
p=r/'scripts/setup.ts';s=p.read_text().replace("spawn(process.execPath,['--import','tsx',resolve(root,'scripts/postgres.ts')],{stdio:'inherit',windowsHide:true,env:process.env});", "const child=spawn(process.execPath,['--import','tsx',resolve(root,'scripts/postgres.ts'),'--background'],{stdio:'inherit',windowsHide:true,env:process.env});child.unref();");p.write_text(s)
p=r/'scripts/postgres.ts';s=p.read_text().replace("for(const signal of ['SIGINT','SIGTERM']", "if(process.argv.includes('--background')&&process.platform==='win32'&&process.arch==='arm64')process.exit(0);\nfor(const signal of ['SIGINT','SIGTERM']");p.write_text(s)
