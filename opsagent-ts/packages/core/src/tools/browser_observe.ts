import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_observe",
  description:
    "Read visible text, numbered elements, URL, and screenshot from the current page.",
  schema: z.object({}),
  riskTier: "READ",
  run: async (args, ctx) => {
    return ctx.browser.observe();
  },
});
