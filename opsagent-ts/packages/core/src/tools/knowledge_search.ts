import { z } from "zod";
import { defineTool } from "./define";
import { searchKnowledge } from "../store";
export default defineTool({
  name: "knowledge_search",
  description:
    "Search only this employee and organization SOP documents using PostgreSQL full-text rank.",
  schema: z.object({ query: z.string().min(1) }),
  riskTier: "READ",
  run: async (args, ctx) => {
    return {
      documents: await searchKnowledge(
        ctx.employee.org_id,
        ctx.employee.id,
        args.query,
      ),
    };
  },
});
