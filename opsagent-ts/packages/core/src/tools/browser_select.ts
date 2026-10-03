import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_select",
  description: "Select a visible option by its exact value or label.",
  schema: z.object({ id: z.number().int().positive(), value: z.string() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    const el = ctx.browser.element(args.id);
    try {
      await el.selectOption(args.value);
    } catch {
      await el.selectOption({ label: args.value });
    }
    return { selected: true };
  },
});
