import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_click",
  description:
    "Click a numbered element from the most recent observation. Form submissions are policy checked in code.",
  schema: z.object({ id: z.number().int().positive() }),
  riskTier: "WRITE",
  prepare: async (args, ctx) => ctx.browser.actionFor(args.id),
  run: async (args, ctx) => {
    await ctx.browser.element(args.id).click();
    ctx.browser.invalidate();
    await ctx.browser.save();
    return ctx.browser.observe();
  },
});
