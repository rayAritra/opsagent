import { z } from "zod";
export type RiskTier = "READ" | "WRITE" | "EXTERNAL_SEND";
export type ErrorType =
  | "TRANSIENT"
  | "ELEMENT_NOT_FOUND"
  | "AUTH_EXPIRED"
  | "VALIDATION"
  | "PERMISSION_DENIED"
  | "POLICY_BLOCKED"
  | "UNKNOWN";
export type Result<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; errorType: ErrorType };
export const stateSchema = z.enum([
  "QUEUED",
  "UNDERSTANDING",
  "PLANNING",
  "EXECUTING",
  "AWAITING_APPROVAL",
  "AWAITING_INPUT",
  "VERIFYING",
  "COMPLETED",
  "FAILED",
  "ESCALATED",
  "CANCELLED",
]);
export type State = z.infer<typeof stateSchema>;
export const requirementSchema=z.object({kind:z.enum(['require_approval','deny_operation','approval_above','required_input']),operation:z.string(),field:z.string().optional(),threshold:z.number().nonnegative().optional(),citation:z.string().min(1)});
export type Requirement=z.infer<typeof requirementSchema>;
export const specSchema = z.object({
  constraints:z.array(requirementSchema).default([]),
  outcome: z.string().min(1),
  inputs: z.array(z.string()),
  policies: z.array(z.object({ rule: z.string(), citation: z.string() })),
  criteria: z.array(z.string().min(1)).min(1),
  blockingQuestion: z.string().optional(),
});
export type TaskSpec = z.infer<typeof specSchema>;
export type Connector = { url: string; credentialHandle: string };
export const employeeSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  name: z.string(),
  role_prompt: z.string(),
  allowed_tools: z.array(z.string()),
  model: z.string().nullable(),
  connectors: z.record(
    z.object({ url: z.string().url(), credentialHandle: z.string() }),
  ),
  policies: z.object({
    allowedOrigins: z.array(z.string().url()),
    approvalAbove: z.number().nonnegative().default(50000),
    requireApprovalFor: z
      .array(z.string())
      .default(["vendor_update", "mail_send"]),
    allowedEmailDomains: z.array(z.string()).default([]),
    denyExternalNavigation: z.boolean().default(true),
  }),
});
export type Employee = z.infer<typeof employeeSchema>;
export type Call = { name: string; args: Record<string, unknown> };
export type Frame = { role: "user" | "assistant"; content: string };
export type Checkpoint = {
  costKnown?:boolean;
  spec?: TaskSpec;
  plan?: string[];
  memory: Record<string, string>;
  history: Frame[];
  steps: number;
  tokens: number;
  cost: number;
  activeMs: number;
  recoveries: number;
  corrections: number;
  url?: string;
  pending?: Call;
  humanAnswers: string[];
  failures: Record<string, number>;
  startedAt: string;
  observation?: string;
};
export type Run = {
  id: string;
  org_id: string;
  employee_id: string;
  task: string;
  status: State;
  checkpoint: Checkpoint;
  report: unknown;
  created_at: Date;
  updated_at: Date;
};
export function initialCheckpoint(): Checkpoint {
  return {
    memory: {},
    history: [],
    steps: 0,
    tokens: 0,
    cost: 0,
    activeMs: 0,
    recoveries: 0,
    corrections: 0,
    humanAnswers: [],
    failures: {},
    startedAt: new Date().toISOString(),
  };
}
export type Action = {
  riskTier?:RiskTier;
  operation: string;
  values: Record<string, string>;
  domain?: string;
  vendor?: string;
  url: string;
  source?: { sender: string; subject: string; body: string };
};
