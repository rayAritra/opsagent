import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_navigate",
  description: "Navigate to a configured connector URL.",
  schema: z.object({ url: z.string().url() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    await ctx.browser.navigate(args.url);
    return ctx.browser.observe();
  },
});
