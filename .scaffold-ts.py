from pathlib import Path
import json
r=Path('opsagent-ts')
def w(p,s):
 p=r/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf-8')
p=json.loads((r/'package.json').read_text());p['devDependencies']['embedded-postgres']='16.14.0-beta.17';w('package.json',json.dumps(p,indent=2))
for app,port in [('console',3000),('mock-company',3001)]:
 w(f'apps/{app}/package.json',json.dumps({'name':f'@opsagent/{app}','private':True,'scripts':{'dev':f'next dev --hostname 127.0.0.1 -p {port}','build':'next build','typecheck':'tsc --noEmit'},'dependencies':{'next':'15.5.27','react':'^19.1.0','react-dom':'^19.1.0','@opsagent/db':'workspace:*','@opsagent/core':'workspace:*','lucide-react':'^0.468.0','@radix-ui/react-slot':'^1.2.0','class-variance-authority':'^0.7.1','clsx':'^2.1.1','tailwind-merge':'^3.0.0'},'devDependencies':{'tailwindcss':'^3.4.17','postcss':'^8.5.0','autoprefixer':'^10.4.0'}}))
 w(f'apps/{app}/tsconfig.json',json.dumps({'extends':'../../tsconfig.base.json','compilerOptions':{'plugins':[{'name':'next'}],'incremental':True},'include':['next-env.d.ts','**/*.ts','**/*.tsx','.next/types/**/*.ts'],'exclude':['node_modules']}))
 w(f'apps/{app}/next.config.mjs',"export default {transpilePackages:['@opsagent/db','@opsagent/core'],serverExternalPackages:['pg','pg-boss','playwright','unpdf'],experimental:{serverActions:{bodySizeLimit:'2mb'}}};\n")
 w(f'apps/{app}/app/layout.tsx',"import type {ReactNode} from 'react';\nexport default function Layout({children}:{children:ReactNode}){return <html lang=\"en\"><body>{children}</body></html>}\n")
 w(f'apps/{app}/app/page.tsx',f"export default function Home(){{return <main><h1>OpsAgent — {app}</h1><p>Platform ready.</p></main>}}\n")
for pkg in ['core','db']:
 deps={'zod':'^3.25.0','dotenv':'^17.0.0'}
 if pkg=='db':deps.update({'pg':'^8.16.0','drizzle-orm':'^0.44.0','pg-boss':'12.35.1','pdf-lib':'^1.17.1'})
 else:deps.update({'@opsagent/db':'workspace:*','playwright':'^1.58.0','@anthropic-ai/sdk':'^0.68.0','openai':'^6.0.0','unpdf':'^1.4.0','zod-to-json-schema':'^3.25.0'})
 w(f'packages/{pkg}/package.json',json.dumps({'name':f'@opsagent/{pkg}','private':True,'type':'module','exports':{'.':'./src/index.ts','./*':'./src/*.ts'},'scripts':{'typecheck':'tsc --noEmit'},'dependencies':deps}))
 w(f'packages/{pkg}/tsconfig.json','{"extends":"../../tsconfig.base.json","include":["src/**/*.ts"]}')
 w(f'packages/{pkg}/src/index.ts','export {};\n')
w('apps/worker/package.json',json.dumps({'name':'@opsagent/worker','private':True,'type':'module','scripts':{'dev':'tsx src/index.ts','typecheck':'tsc --noEmit'},'dependencies':{'@opsagent/core':'workspace:*','@opsagent/db':'workspace:*','tsx':'^4.20.0','yaml':'^2.8.0'}}))
w('apps/worker/tsconfig.json','{"extends":"../../tsconfig.base.json","include":["src/**/*.ts"]}')
w('apps/worker/src/index.ts',"console.log('Browser worker ready'); setInterval(()=>{},60000);\n")
w('scripts/env.ts',r'''import {config} from 'dotenv';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
export const root=process.cwd();
config({path:resolve(root,'.env'),quiet:true});
export const pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm';
export const hasLocalDb=existsSync(resolve(root,'.local/postgres/PG_VERSION'));
''')
w('scripts/postgres.ts',r'''import './env';
import EmbeddedPostgres from 'embedded-postgres';
import {existsSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const databaseDir=resolve('.local/postgres');
mkdirSync('.local',{recursive:true});
const pg=new EmbeddedPostgres({databaseDir,user:'opsagent',password:'opsagent',port:5433,persistent:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:console.error});
if(!existsSync(resolve(databaseDir,'PG_VERSION'))) await pg.initialise();
await pg.start();
const client=pg.getPgClient(); await client.connect();
if(!(await client.query("SELECT 1 FROM pg_database WHERE datname='opsagent'")).rowCount) await pg.createDatabase('opsagent');
await client.end();console.log('PostgreSQL 16 ready on 127.0.0.1:5433');
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{void pg.stop().then(()=>process.exit(0));});
setInterval(()=>{},60000);
''')
w('scripts/setup.ts',r'''import './env';
import {spawnSync,spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {pnpm} from './env';
function command(args:string[]){const p=spawnSync(pnpm,args,{stdio:'inherit',shell:process.platform==='win32'});if(p.status!==0)throw Error(`Setup failed: pnpm ${args.join(' ')}`);}
if(!existsSync('.env'))writeFileSync('.env',readFileSync('.env.example','utf8').replace('CREDENTIAL_ENCRYPTION_KEY=','CREDENTIAL_ENCRYPTION_KEY='+randomBytes(32).toString('hex')).replace('SESSION_SECRET=','SESSION_SECRET='+randomBytes(32).toString('hex')));
command(['install','--frozen-lockfile']);command(['exec','playwright','install','chromium']);
const local=process.argv.includes('--local-db');
let child:ReturnType<typeof spawn>|undefined;
if(local){child=spawn(pnpm,['db:local'],{stdio:'inherit',shell:process.platform==='win32'});await new Promise(r=>setTimeout(r,7000));}
else {const p=spawnSync('docker',['compose','up','-d','--wait'],{stdio:'inherit'});if(p.status!==0)throw Error('Docker unavailable. Install Docker or use pnpm setup --local-db.');}
try{command(['db:migrate']);command(['seed']);}finally{child?.kill();}
console.log('Setup complete. Run pnpm dev'+(local?' --local-db':''));
''')
w('scripts/dev.ts',r'''import './env';
import {spawn} from 'node:child_process';
import {pnpm} from './env';
const children:ReturnType<typeof spawn>[]=[];
function start(args:string[]){const child=spawn(pnpm,args,{stdio:'inherit',shell:process.platform==='win32',env:process.env});children.push(child);child.on('exit',code=>{if(code&&code!==0)console.error(`Process ${args.join(' ')} exited ${code}`);});}
if(process.argv.includes('--local-db')){start(['db:local']);await new Promise(r=>setTimeout(r,4000));}
for(const app of ['console','mock-company','worker'])start(['--filter',`@opsagent/${app}`,'dev']);
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{for(const child of children)child.kill();process.exit(0);});
''')
w('packages/db/src/migrate.ts',"console.log('Scaffold migration ready');\n")
w('packages/db/src/seed.ts',"console.log('Scaffold seed ready');\n")
w('.github/workflows/ci.yml',r'''name: TypeScript checks
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: {POSTGRES_USER: opsagent, POSTGRES_PASSWORD: opsagent, POSTGRES_DB: opsagent}
        ports: ['5433:5432']
        options: --health-cmd "pg_isready -U opsagent" --health-interval 2s --health-retries 30
    defaults:
      run:
        working-directory: opsagent-ts
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: {version: 10.18.0}
      - uses: actions/setup-node@v4
        with: {node-version: 22, cache: pnpm, cache-dependency-path: opsagent-ts/pnpm-lock.yaml}
      - run: pnpm install --frozen-lockfile
      - run: pnpm setup
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
''')
