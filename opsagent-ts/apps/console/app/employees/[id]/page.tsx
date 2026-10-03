import { notFound } from "next/navigation";
import { query, env } from "@opsagent/db";
import type { Employee } from "@opsagent/core";
import { organization } from "../../../lib/auth";
import { Shell } from "../../../components/shell";
import { EmployeeEditor } from "../../../components/employee-editor";
export const dynamic = "force-dynamic";
export default async function EmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const org = await organization();
  const { id } = await params;
  const catalog=await query<{name:string;risk_tier:string}>('SELECT name,risk_tier FROM platform.tool_catalog WHERE org_id=$1 ORDER BY name',[org.org_id]);
  if (id === "new")
    return (
      <Shell>
        <EmployeeEditor
          catalog={catalog}
          employee={{
            name: "",
            role_prompt: "",
            allowed_tools: [
              "browser_navigate",
              "browser_observe",
              "browser_login",
              "knowledge_search",
              "ask_human",
              "finish",
            ],
            policies: {
              allowedOrigins: [new URL(env.MOCK_COMPANY_URL).origin],
              approvalAbove: 50000,
              requireApprovalFor: ["vendor_update", "mail_send"],
              allowedEmailDomains: ["acme.test"],
              denyExternalNavigation: true,
            },
            connectors: {},
            model: null,
          }}
          documents={[]}
          handles={[]}
          lessons={[]}
        />
      </Shell>
    );
  const [employee] = await query<Employee>(
    "SELECT * FROM platform.ai_employees WHERE org_id=$1 AND id=$2",
    [org.org_id, id],
  );
  if (!employee) notFound();
  const [documents, handles, lessons] = await Promise.all([
    query<{ id: string; title: string; content: string }>(
      "SELECT id,title,content FROM platform.knowledge_docs WHERE org_id=$1 AND employee_id=$2",
      [org.org_id, id],
    ),
    query<{ handle: string }>(
      "SELECT handle FROM platform.credentials WHERE org_id=$1 AND employee_id=$2",
      [org.org_id, id],
    ),
    query<{ id: string; content: string }>(
      "SELECT id,content FROM platform.lessons WHERE org_id=$1 AND employee_id=$2",
      [org.org_id, id],
    ),
  ]);
  return (
    <Shell>
      <EmployeeEditor
          catalog={catalog}
        employee={employee}
        documents={documents}
        handles={handles}
        lessons={lessons}
      />
    </Shell>
  );
}
