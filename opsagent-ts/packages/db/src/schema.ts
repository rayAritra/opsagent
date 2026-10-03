import {
  pgSchema,
  uuid,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  numeric,
  serial,
} from "drizzle-orm/pg-core";
const platform = pgSchema("platform");
const identity = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const orgs = platform.table("orgs", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
});
export const employees = platform.table("ai_employees", {
  ...identity(),
  name: text("name").notNull(),
  rolePrompt: text("role_prompt").notNull(),
  allowedTools: jsonb("allowed_tools").notNull(),
  policies: jsonb("policies").notNull(),
  connectors: jsonb("connectors").notNull(),
  model: text("model"),
});
export const knowledgeDocs = platform.table("knowledge_docs", {
  ...identity(),
  employeeId: uuid("employee_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
});
export const knowledgeChunks = platform.table("knowledge_chunks", {
  ...identity(),
  employeeId: uuid("employee_id").notNull(),
  docId: uuid("doc_id").notNull(),
  content: text("content").notNull(),
});
export const credentials = platform.table("credentials", {
  ...identity(),
  employeeId: uuid("employee_id").notNull(),
  handle: text("handle").notNull(),
  ciphertext: text("ciphertext").notNull(),
});
export const runs = platform.table("runs", {
  ...identity(),
  employeeId: uuid("employee_id").notNull(),
  task: text("task").notNull(),
  status: text("status").notNull(),
  checkpoint: jsonb("checkpoint").notNull(),
  report: jsonb("report"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const runSteps = platform.table("run_steps", {
  ...identity(),
  runId: uuid("run_id").notNull(),
  index: integer("index").notNull(),
  kind: text("kind").notNull(),
  tool: text("tool"),
  args: jsonb("args"),
  result: jsonb("result"),
  errorType: text("error_type"),
  screenshot: text("screenshot"),
  tokens: integer("tokens").default(0),
  latency: integer("latency").default(0),
});
export const approvals = platform.table("approvals", {
  ...identity(),
  runId: uuid("run_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  action: jsonb("action").notNull(),
  reason: text("reason").notNull(),
  citation: text("citation").notNull(),
  status: text("status").notNull(),
  comment: text("comment"),
});
export const questions = platform.table("questions", {
  ...identity(),
  runId: uuid("run_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer"),
  status: text("status").notNull(),
});
export const events = platform.table("run_events", {
  id: serial("id").primaryKey(),
  orgId: uuid("org_id").notNull(),
  runId: uuid("run_id").notNull(),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
export const lessons = platform.table("lessons", {
  ...identity(),
  employeeId: uuid("employee_id").notNull(),
  content: text("content").notNull(),
});
export const auditLog = platform.table("audit_log", {
  ...identity(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payload: jsonb("payload").notNull(),
});
export const evaluations = platform.table("evals", {
  ...identity(),
  chaos: boolean("chaos").notNull(),
  results: jsonb("results").notNull(),
});
export const portal = pgSchema("mock_portal"),
  erp = pgSchema("mock_erp"),
  mail = pgSchema("mock_mail");
export const invoices = portal.table("invoices", {
  id: text("id").primaryKey(),
  vendor: text("vendor").notNull(),
  number: text("number").notNull(),
  amount: numeric("amount").notNull(),
  date: text("date").notNull(),
  due: text("due"),
  pdf: text("pdf").notNull(),
});
export const vendors = erp.table("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  notes: text("notes").notNull(),
});
export const payables = erp.table("payables", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendor: text("vendor").notNull(),
  number: text("number").notNull(),
  amount: numeric("amount").notNull(),
  due: text("due").notNull(),
  status: text("status").notNull(),
  enteredBy: text("entered_by").notNull(),
  notes: text("notes").notNull(),
});
export const messages = mail.table("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  sender: text("sender").notNull(),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  folder: text("folder").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
