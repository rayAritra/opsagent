import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "files_list",
  description: "List safe run artifacts. Browser session state is private.",
  schema: z.object({}),
  riskTier: "READ",
  run: async (args, ctx) => {
    return { files: await ctx.browser.files() };
  },
});
