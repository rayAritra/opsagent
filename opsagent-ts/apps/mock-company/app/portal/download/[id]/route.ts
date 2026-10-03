import { authenticated } from "../../../../lib/session";
import { query, projectRoot } from "@opsagent/db";
import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await authenticated("portal")))
    return new Response("Sign in required", { status: 401 });
  const { id } = await params;
  const [row] = await query<{ pdf: string; number: string }>(
    "SELECT pdf,number FROM mock_portal.invoices WHERE id=$1",
    [id],
  );
  if (!row) return new Response("Not found", { status: 404 });
  const base = resolve(projectRoot, "artifacts/seed-pdfs");
  if (relative(base, resolve(row.pdf)).startsWith(".."))
    return new Response("Invalid file", { status: 403 });
  return new Response(new Uint8Array(await readFile(row.pdf)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${row.number.replace(/[^a-z0-9-]/gi, "_")}.pdf"`,
    },
  });
}
