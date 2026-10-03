import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_download",
  description: "Download a link into the isolated run directory.",
  schema: z.object({ id: z.number().int().positive() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    return ctx.browser.download(args.id);
  },
});
