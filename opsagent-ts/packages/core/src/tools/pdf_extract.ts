import { z } from "zod";
import { defineTool } from "./define";
import { readFile } from "node:fs/promises";
import { extractText } from "unpdf";
import { untrusted } from "../untrusted";
export default defineTool({
  name: "pdf_extract",
  description: "Extract real PDF text from a downloaded run artifact.",
  schema: z.object({ file: z.string() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    const bytes = await readFile(ctx.browser.file(args.file));
    const result = await extractText(new Uint8Array(bytes), {
      mergePages: true,
    });
    return { text: untrusted(String(result.text), args.file) };
  },
});
