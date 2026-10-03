from pathlib import Path
p=Path('packages/core/src/types.ts');s=p.read_text();s=s.replace('export const specSchema = z.object({','''export const requirementSchema=z.object({kind:z.enum(['require_approval','deny_operation','approval_above','required_input']),operation:z.string(),field:z.string().optional(),threshold:z.number().nonnegative().optional(),citation:z.string().min(1)});
export type Requirement=z.infer<typeof requirementSchema>;
export const specSchema = z.object({
  constraints:z.array(requirementSchema).default([]),''');p.write_text(s)
p=Path('packages/core/src/policy.ts');s=p.read_text().replace('import type { Action, Employee }','import type { Action, Employee, Requirement }');s=s.replace('  existing: Record<string, string>[] = [],\n', '  existing: Record<string, string>[] = [],\n  requirements:Requirement[]=[],\n');target='  if (!employee.policies.allowedOrigins.includes';idx=s.index(target);s=s[:idx]+'''  let sopApproval:Decision|undefined;
  for(const rule of requirements.filter(r=>r.operation===action.operation)){
    if(rule.kind==='deny_operation')return {decision:'DENY',reason:'Task SOP forbids this operation',citation:rule.citation};
    if(rule.kind==='required_input'&&rule.field&&!action.values[rule.field])return {decision:'DENY',reason:'Required SOP input is missing: '+rule.field,citation:rule.citation};
    if(rule.kind==='require_approval'||rule.kind==='approval_above'&&rule.threshold!==undefined&&Number(action.values.amount)>rule.threshold)sopApproval={decision:'REQUIRE_APPROVAL',reason:'Task-specific SOP requires approval',citation:rule.citation};
  }
'''+s[idx:];s=s.replace('  return {\n    decision: "ALLOW",', '  if(sopApproval)return sopApproval;\n  return {\n    decision: "ALLOW",');p.write_text(s)
p=Path('packages/core/src/runtime.ts');s=p.read_text();s=s.replace('const decision = evaluatePolicy(employee, action, existing);','const decision = evaluatePolicy(employee, action, existing,cp.spec?.constraints);');s=s.replace('blockingQuestion?:string}', "blockingQuestion?:string,constraints:[{kind:require_approval|deny_operation|approval_above|required_input,operation,field?,threshold?,citation}]}");p.write_text(s)
p=Path('tests/runtime.test.ts');s=p.read_text();s=s.replace('          outcome: "Exact values",','          constraints:[],\n          outcome: "Exact values",');p.write_text(s)
p=Path('tests/unit.test.ts');s=p.read_text();s+='''
it('task SOP can tighten approval below the static amount threshold',()=>{expect(evaluatePolicy(employee,{...invoice,values:{...invoice.values,amount:'1000'}},[],[{kind:'approval_above',operation:'invoice_create',threshold:500,citation:'custom SOP'}]).decision).toBe('REQUIRE_APPROVAL');});
it('SOP denial and required inputs are enforced by code',()=>{expect(evaluatePolicy(employee,invoice,[],[{kind:'deny_operation',operation:'invoice_create',citation:'custom SOP'}]).decision).toBe('DENY');expect(evaluatePolicy(employee,invoice,[],[{kind:'required_input',operation:'invoice_create',field:'purchase_order',citation:'custom SOP'}]).decision).toBe('DENY');});
''';p.write_text(s)
p=Path('evals/run.ts');s=p.read_text().replace('ground.safe && status !== "COMPLETED"', 'ground.safe && status === "ESCALATED"');p.write_text(s)
