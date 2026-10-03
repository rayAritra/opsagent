from pathlib import Path
r=Path('opsagent-ts')
def w(p,s):
 p=r/p;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(s,encoding='utf8')
w('packages/core/src/tools/define.ts',r'''import {z,type ZodTypeAny} from 'zod';
import type {RiskTier,Result,Employee,Action} from '../types';
import type {BrowserSession} from '../browser';
export type ToolContext={employee:Employee;browser:BrowserSession;memory:Record<string,string>;authorize:(action:Action)=>Promise<boolean>;ask:(question:string)=>Promise<void>};
export type Tool={name:string;description:string;schema:ZodTypeAny;riskTier:RiskTier;execute:(args:unknown,context:ToolContext)=>Promise<Result>};
export function defineTool<S extends ZodTypeAny>(config:{name:string;description:string;schema:S;riskTier:RiskTier;run:(args:z.infer<S>,context:ToolContext)=>Promise<unknown>}):Tool{return {...config,execute:async(args,context)=>{try{return {ok:true,data:await config.run(config.schema.parse(args),context)};}catch(e){const message=e instanceof Error?e.message:'Unknown tool error';const known=['TRANSIENT','ELEMENT_NOT_FOUND','AUTH_EXPIRED','VALIDATION','PERMISSION_DENIED','POLICY_BLOCKED'] as const;const type=known.find(t=>message.startsWith(t))||(e instanceof z.ZodError?'VALIDATION':/Timeout|net::|ECONN/.test(message)?'TRANSIENT':'UNKNOWN');return {ok:false,error:message.slice(0,1500),errorType:type};}}};}
''')
def tool(name,desc,schema,risk,run,extra=''):
 w(f'packages/core/src/tools/{name}.ts',f"import {{z}} from 'zod';\nimport {{defineTool}} from './define';\n{extra}\nexport default defineTool({{name:'{name}',description:{desc!r},schema:{schema},riskTier:'{risk}',run:async(args,ctx)=>{{{run}}}}});\n")
tool('browser_navigate','Navigate to a configured connector URL.','z.object({url:z.string().url()})','READ',"await ctx.browser.navigate(args.url);return ctx.browser.observe();")
tool('browser_observe','Read visible text, numbered elements, URL, and screenshot from the current page.','z.object({})','READ',"return ctx.browser.observe();")
tool('browser_click','Click a numbered element from the most recent observation. Form submissions are policy checked in code.','z.object({id:z.number().int().positive()})','WRITE',"const action=await ctx.browser.actionFor(args.id);if(action&&action.operation!=='login'&&!await ctx.authorize(action))return {parked:true};if(action?.operation==='login')throw Error('PERMISSION_DENIED: use browser_login credential handles');await ctx.browser.element(args.id).click();ctx.browser.invalidate();await ctx.browser.save();return ctx.browser.observe();")
tool('browser_type','Fill a visible field. Password fields are reserved for browser_login.','z.object({id:z.number().int().positive(),text:z.string().max(50000)})','READ',"const el=ctx.browser.element(args.id);if(await el.getAttribute('type')==='password')throw Error('PERMISSION_DENIED: use credential handle');await el.fill(args.text);return {filled:true};")
tool('browser_select','Select a visible option by its exact value or label.','z.object({id:z.number().int().positive(),value:z.string()})','READ',"const el=ctx.browser.element(args.id);try{await el.selectOption(args.value);}catch{await el.selectOption({label:args.value});}return {selected:true};")
tool('browser_login','Sign in to a configured connector without exposing its secret.','z.object({system:z.string(),credential_handle:z.string()})','READ',"return ctx.browser.login(args.system,args.credential_handle);")
tool('browser_download','Download a link into the isolated run directory.','z.object({id:z.number().int().positive()})','READ',"return ctx.browser.download(args.id);")
tool('files_list','List safe run artifacts. Browser session state is private.','z.object({})','READ',"return {files:await ctx.browser.files()};")
tool('files_read','Read a run-local UTF-8 file as untrusted text.','z.object({file:z.string()})','READ',"return {text:untrusted(await ctx.browser.read(args.file),args.file)};","import {untrusted} from '../untrusted';")
tool('pdf_extract','Extract real PDF text from a downloaded run artifact.','z.object({file:z.string()})','READ',"const bytes=await readFile(ctx.browser.file(args.file));const result=await extractText(new Uint8Array(bytes),{mergePages:true});return {text:untrusted(String(result.text),args.file)};","import {readFile} from 'node:fs/promises';\nimport {extractText} from 'unpdf';\nimport {untrusted} from '../untrusted';")
tool('knowledge_search','Search only this employee and organization SOP documents using PostgreSQL full-text rank.','z.object({query:z.string().min(1)})','READ',"return {documents:await searchKnowledge(ctx.employee.org_id,ctx.employee.id,args.query)};","import {searchKnowledge} from '../store';")
tool('memory_note','Store a bounded factual note in the current run scratchpad.','z.object({key:z.string().max(80),value:z.string().max(2000)})','READ',"if(Object.keys(ctx.memory).length>=40&&!Object.hasOwn(ctx.memory,args.key))throw Error('VALIDATION: scratchpad limit');ctx.memory[args.key]=args.value;return {saved:true};")
tool('ask_human','Park this run with a blocking question. The worker job ends; the answer resumes it.','z.object({question:z.string().min(1).max(2000)})','READ',"await ctx.ask(args.question);return {parked:true};")
tool('finish','Request independent verification. Claimed outcomes cannot mark a run verified.','z.object({summary:z.string().max(2000),claimed_outcome:z.string().max(2000)})','READ',"return {requestedVerification:true,summary:args.summary,claimedOutcome:args.claimed_outcome};")
w('packages/core/src/registry.ts',r'''import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {projectRoot} from '@opsagent/db';
import type {Tool,ToolContext} from './tools/define';
import type {Call,Result} from './types';
import type {Definition} from './llm';
export class Registry{
 readonly tools=new Map<string,Tool>();
 static async load(){const registry=new Registry();const folder=resolve(projectRoot,'packages/core/src/tools');for(const file of (await readdir(folder)).filter(f=>f.endsWith('.ts')&&f!=='define.ts').sort()){const module=await import(pathToFileURL(resolve(folder,file)).href) as {default:Tool};registry.tools.set(module.default.name,module.default);}return registry;}
 definitions(allowed:string[]):Definition[]{return [...this.tools.values()].filter(t=>allowed.includes(t.name)).map(t=>({name:t.name,description:t.description,input_schema:zodToJsonSchema(t.schema,{$refStrategy:'none'}) as Record<string,unknown>}));}
 async execute(call:Call,context:ToolContext):Promise<Result>{if(!context.employee.allowed_tools.includes(call.name))return {ok:false,error:'Tool not allowed for employee',errorType:'PERMISSION_DENIED'};const tool=this.tools.get(call.name);if(!tool)return {ok:false,error:'Unknown tool',errorType:'VALIDATION'};return tool.execute(call.args,context);}
}
''')
w('packages/core/src/verifier.ts',r'''import {z} from 'zod';
import {extractText} from 'unpdf';
import {readFile} from 'node:fs/promises';
import {BrowserSession} from './browser';
import type {Employee,TaskSpec} from './types';
import type {Provider} from './llm';
import {boundaryPrompt,untrusted} from './untrusted';
const checkSchema=z.object({criterion:z.number().int().nonnegative(),system:z.string(),kind:z.enum(['payable','vendor','message','source_invoice','safe_refusal']),match:z.record(z.string()),expected:z.record(z.string()),sourcePdf:z.string().optional(),absent:z.boolean().default(false)});
const judgment=z.object({checks:z.array(checkSchema),reason:z.string()});
export type Verification={status:'VERIFIED'|'PARTIAL'|'FAILED';criteria:{criterion:string;passed:boolean;evidence:string}[];tokens:number;cost:number;freshEvidence:unknown};
export async function verify(employee:Employee,runId:string,task:string,spec:TaskSpec,humanAnswers:string[],provider:Provider):Promise<Verification>{
 const session=new BrowserSession(employee,runId,true);const evidence:Record<string,unknown>={},records:Record<string,Record<string,string>[]>={},pdfs:Record<string,string>={};
 try{await session.start();for(const [system,cfg]of Object.entries(employee.connectors)){await session.login(system,cfg.credentialHandle);await session.navigate(cfg.url);await session.observe();const kind=system==='erp'?'payable':system==='mail'?'message':'source_invoice';records[system+':'+kind]=await readRecords(session,kind);evidence[system]=untrusted(await session.page!.locator('body').innerText(),cfg.url);
 if(system==='erp'){await session.navigate(cfg.url+'/vendors');records[system+':vendor']=await readRecords(session,'vendor');}
 if(system==='mail'){await session.navigate(cfg.url+'/sent');const links=await session.page!.locator('tbody a').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href));const sent:Record<string,string>[]=[];for(const url of links){await session.navigate(url);sent.push(...await readRecords(session,'message'));}records[system+':message']=sent;}
 if(system==='portal'){const details:string[]=[];for(let page=1;page<=20;page++){await session.navigate(cfg.url+'?page='+page);details.push(...await session.page!.locator('tbody a').evaluateAll(nodes=>nodes.map(n=>(n as HTMLAnchorElement).href)));if(!await session.page!.getByRole('link',{name:'Next page',exact:true}).count())break;}for(const url of [...new Set(details)]){await session.navigate(url);await session.observe();const link=session.page!.locator('a[download]');if(!await link.count())continue;const [d]=await Promise.all([session.page!.waitForEvent('download'),link.click()]);const filename=d.suggestedFilename().replace(/[^a-z0-9_.-]/gi,'_');const path=session.file(filename);await d.saveAs(path);pdfs[filename]=String((await extractText(new Uint8Array(await readFile(path)),{mergePages:true})).text);}}
 }
 const response=await provider.json(boundaryPrompt+' You are an independent verifier. You see the original goal, fixed success criteria, human answers, and FRESH browser state and PDFs. You do not see actor claims. Propose checks for EVERY criterion. Matching an unrelated row does not satisfy the goal. Prefer exact field comparisons. safe_refusal is only applicable to an unsafe or impossible goal, never to a successful operational goal. Return {checks:[{criterion:0,system,kind,match:{},expected:{},sourcePdf?,absent:false}],reason}. For invoice entries, require sourcePdf and expected vendor/number/amount/due. For duplicates, confirm the existing row and original PDF; do not use absent checks. For contact updates, require expected email/phone/notes. For sent messages, require expected recipient/subject/body. Each criterion must have substantive checks.',JSON.stringify({task,spec,humanAnswers,evidence,records,pdfs:Object.fromEntries(Object.entries(pdfs).map(([k,v])=>[k,untrusted(v,k)]))}));
 const proposed=judgment.parse(response.value);const results=spec.criteria.map((criterion,index)=>{const checks=proposed.checks.filter(c=>c.criterion===index);const evaluated=checks.map(check=>{if(check.kind==='safe_refusal')return {passed:false,evidence:'A refusal needs operator review and is never marked VERIFIED.'};const candidates=(records[check.system+':'+check.kind]||[]).filter(row=>Object.keys(check.match).length>0&&Object.entries(check.match).every(([k,v])=>equal(k,row[k],v)));if(check.absent)return {passed:false,evidence:'Absence is not sufficient evidence of task completion.'};if(!candidates.length)return {passed:false,evidence:'No independently observed matching record.'};let passed=Object.keys(check.expected).length>0&&candidates.some(row=>Object.entries(check.expected).every(([k,v])=>equal(k,row[k],v)));if(check.kind==='payable'){const text=check.sourcePdf?pdfs[check.sourcePdf]:undefined;passed=passed&&Boolean(text)&&['vendor','number','amount','due'].every(k=>Boolean(check.expected[k]));if(text){passed=passed&&text.includes(check.expected.vendor)&&text.includes(check.expected.number)&&sourceHasAmount(text,check.expected.amount);if(!text.includes(check.expected.due))passed=passed&&humanAnswers.some(a=>a.includes(check.expected.due));}}
 if(check.kind==='vendor')passed=passed&&['email','phone','notes'].every(k=>Boolean(check.expected[k]));if(check.kind==='message')passed=passed&&['recipient','subject','body'].every(k=>Boolean(check.expected[k]));return {passed,evidence:JSON.stringify({kind:check.kind,match:check.match,expected:check.expected,observed:candidates,sourcePdf:check.sourcePdf})};});return {criterion,passed:checks.length>0&&evaluated.every(e=>e.passed),evidence:evaluated.map(e=>e.evidence).join('\n')||'Verifier produced no substantive check.'};});
 const count=results.filter(r=>r.passed).length;return {status:count===results.length?'VERIFIED':count?'PARTIAL':'FAILED',criteria:results,tokens:response.tokens,cost:response.cost,freshEvidence:{records,pdfNames:Object.keys(pdfs)}};
 }finally{await session.close();}
}
async function readRecords(session:BrowserSession,kind:string){return session.page!.locator(`[data-record="${kind}"]`).evaluateAll(nodes=>nodes.map(n=>{const out:Record<string,string>={};for(const field of n.querySelectorAll('[data-field]'))out[field.getAttribute('data-field')!]=(field.textContent||'').trim();return out;}));}
function equal(key:string,a:string|undefined,b:string){return key==='amount'?Number(a)===Number(b):a===b;}
export function sourceHasAmount(text:string,amount:string){const values=[...text.matchAll(/(?:Amount\s*INR\s*:|Total\s*INR)\s*([\d,]+(?:\.\d{2})?)/gi)].map(m=>Number(m[1].replace(/,/g,'')));return values.includes(Number(amount));}
''')
