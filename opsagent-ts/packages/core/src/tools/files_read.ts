import { z } from "zod";
import { defineTool } from "./define";
import { untrusted } from "../untrusted";
export default defineTool({
  name: "files_read",
  description: "Read a run-local UTF-8 file as untrusted text.",
  schema: z.object({ file: z.string() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    return { text: untrusted(await ctx.browser.read(args.file), args.file) };
  },
});
