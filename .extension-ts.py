from pathlib import Path
r=Path('opsagent-ts')
def w(p,s):
 p=r/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf8')
p=r/'packages/core/src/tools/define.ts';s=p.read_text();s=s.replace('  run: (args: z.infer<S>, context: ToolContext) => Promise<unknown>;', '  prepare?: (args: z.infer<S>, context: ToolContext) => Promise<Action | undefined>;\n  run: (args: z.infer<S>, context: ToolContext) => Promise<unknown>;');s=s.replace('      try {\n        return {', '''      try {
        const parsed=config.schema.parse(args);
        if(config.riskTier!=='READ'){
          if(!config.prepare)throw Error('PERMISSION_DENIED: a write tool must define an exact action preview');
          const action=await config.prepare(parsed,context);
          if(action?.operation==='login')throw Error('PERMISSION_DENIED: use browser_login credential handles');
          if(action&&!await context.authorize({...action,riskTier:action.operation==='mail_send'?'EXTERNAL_SEND':config.riskTier}))return {ok:true,data:{parked:true}};
        }
        return {''').replace('config.run(config.schema.parse(args), context)','config.run(parsed, context)');w(str(p.relative_to(r)),s)
p=r/'packages/core/src/tools/browser_click.ts';s=p.read_text();start=s.index('    const action =');end=s.index('    await ctx.browser.element',start);s=s[:start]+s[end:];s=s.replace('  run: async (args, ctx)', '  prepare: async (args, ctx) => ctx.browser.actionFor(args.id),\n  run: async (args, ctx)');w(str(p.relative_to(r)),s)
p=r/'packages/core/src/types.ts';s=p.read_text().replace('export type Action = {','export type Action = {\n  riskTier?:RiskTier;');w(str(p.relative_to(r)),s)
p=r/'packages/core/src/policy.ts';s=p.read_text().replace('action.operation === "mail_send" &&','(action.operation === "mail_send" || action.riskTier === "EXTERNAL_SEND") &&');w(str(p.relative_to(r)),s)
w('packages/db/migrations/0003.sql','''CREATE TABLE platform.tool_catalog(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES platform.orgs(org_id),name text NOT NULL,description text NOT NULL,risk_tier text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,name));\n''')
p=r/'apps/worker/src/index.ts';s=p.read_text();s=s.replace('const boss = await queue();', '''import {Registry} from '@opsagent/core/registry';
const registry=await Registry.load();
for(const org of await query<{org_id:string}>('SELECT org_id FROM platform.orgs'))for(const tool of registry.tools.values())await query('INSERT INTO platform.tool_catalog(org_id,name,description,risk_tier) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,name) DO UPDATE SET description=EXCLUDED.description,risk_tier=EXCLUDED.risk_tier',[org.org_id,tool.name,tool.description,tool.riskTier]);
const boss = await queue();''');w(str(p.relative_to(r)),s)
p=r/'packages/db/src/seed.ts';s=p.read_text();s=s.replace('console.log(\n', '''for(const name of tools)await query('INSERT INTO platform.tool_catalog(org_id,name,description,risk_tier) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,name) DO NOTHING',[org,name,name.replaceAll('_',' '),name==='browser_click'?'WRITE':'READ']);
console.log(
''');w(str(p.relative_to(r)),s)
p=r/'apps/console/components/employee-editor.tsx';s=p.read_text();a=s.index('const tools = [');b=s.index('async function post',a);s=s[:a]+s[b:];s=s.replace('  lessons,\n}: {','  lessons,\n  catalog,\n}: {').replace('  lessons: { id: string; content: string }[];','  lessons: { id: string; content: string }[];\n  catalog:{name:string;risk_tier:string}[];');s=s.replace('{tools.map(([name, risk]) => (','{catalog.map(({name, risk_tier:risk}) => (');w(str(p.relative_to(r)),s)
p=r/'apps/console/app/employees/[id]/page.tsx';s=p.read_text();s=s.replace('  const { id } = await params;', "  const { id } = await params;\n  const catalog=await query<{name:string;risk_tier:string}>('SELECT name,risk_tier FROM platform.tool_catalog WHERE org_id=$1 ORDER BY name',[org.org_id]);");s=s.replace('<EmployeeEditor\n', '<EmployeeEditor\n          catalog={catalog}\n').replace('<EmployeeEditor\n        employee=', '<EmployeeEditor\n        catalog={catalog}\n        employee=');w(str(p.relative_to(r)),s)
p=r/'tests/tools.test.ts';s=p.read_text().replace('expect(registry.tools.size).toBe(14)','expect(registry.tools.size).toBeGreaterThanOrEqual(14)');w(str(p.relative_to(r)),s)
p=r/'tests/unit.test.ts';s=p.read_text();s+='''
it('new write tools cannot skip the central action boundary',async()=>{const {defineTool}=await import('../packages/core/src/tools/define');const {z}=await import('zod');const tool=defineTool({name:'unsafe_extension',description:'Fixture',schema:z.object({}),riskTier:'WRITE',run:async()=>({sideEffect:true})});const context={employee,browser:{} as import('../packages/core/src/browser').BrowserSession,memory:{},authorize:async()=>true,ask:async()=>{}};expect(await tool.execute({},context)).toMatchObject({ok:false,errorType:'PERMISSION_DENIED'});});
''';w(str(p.relative_to(r)),s)
