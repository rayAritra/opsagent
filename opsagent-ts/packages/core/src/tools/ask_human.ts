import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "ask_human",
  description:
    "Park this run with a blocking question. The worker job ends; the answer resumes it.",
  schema: z.object({ question: z.string().min(1).max(2000) }),
  riskTier: "READ",
  run: async (args, ctx) => {
    await ctx.ask(args.question);
    return { parked: true };
  },
});
