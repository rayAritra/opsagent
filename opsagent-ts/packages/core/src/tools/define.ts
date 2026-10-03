import { z, type ZodTypeAny } from "zod";
import type { RiskTier, Result, Employee, Action } from "../types";
import type { BrowserSession } from "../browser";
export type ToolContext = {
  employee: Employee;
  browser: BrowserSession;
  memory: Record<string, string>;
  authorize: (action: Action) => Promise<boolean>;
  ask: (question: string) => Promise<void>;
};
export type Tool = {
  name: string;
  description: string;
  schema: ZodTypeAny;
  riskTier: RiskTier;
  execute: (args: unknown, context: ToolContext) => Promise<Result>;
};
export function defineTool<S extends ZodTypeAny>(config: {
  name: string;
  description: string;
  schema: S;
  riskTier: RiskTier;
  prepare?: (args: z.infer<S>, context: ToolContext) => Promise<Action | undefined>;
  run: (args: z.infer<S>, context: ToolContext) => Promise<unknown>;
}): Tool {
  return {
    ...config,
    execute: async (args, context) => {
      try {
        const parsed=config.schema.parse(args);
        if(config.riskTier!=='READ'){
          if(!config.prepare)throw Error('PERMISSION_DENIED: a write tool must define an exact action preview');
          const action=await config.prepare(parsed,context);
          if(action?.operation==='login')throw Error('PERMISSION_DENIED: use browser_login credential handles');
          if(action&&!await context.authorize({...action,riskTier:action.operation==='mail_send'?'EXTERNAL_SEND':config.riskTier}))return {ok:true,data:{parked:true}};
        }
        return {
          ok: true,
          data: await config.run(parsed, context),
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown tool error";
        const known = [
          "TRANSIENT",
          "ELEMENT_NOT_FOUND",
          "AUTH_EXPIRED",
          "VALIDATION",
          "PERMISSION_DENIED",
          "POLICY_BLOCKED",
        ] as const;
        const type =
          known.find((t) => message.startsWith(t)) ||
          (e instanceof z.ZodError
            ? "VALIDATION"
            : /Timeout|net::|ECONN/.test(message)
              ? "TRANSIENT"
              : "UNKNOWN");
        return { ok: false, error: message.slice(0, 1500), errorType: type };
      }
    },
  };
}
