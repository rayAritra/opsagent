import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_type",
  description:
    "Fill a visible field. Password fields are reserved for browser_login.",
  schema: z.object({
    id: z.number().int().positive(),
    text: z.string().max(50000),
  }),
  riskTier: "READ",
  run: async (args, ctx) => {
    const el = ctx.browser.element(args.id);
    if ((await el.getAttribute("type")) === "password")
      throw Error("PERMISSION_DENIED: use credential handle");
    await el.fill(args.text);
    return { filled: true };
  },
});
