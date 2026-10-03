import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "memory_note",
  description: "Store a bounded factual note in the current run scratchpad.",
  schema: z.object({ key: z.string().max(80), value: z.string().max(2000) }),
  riskTier: "READ",
  run: async (args, ctx) => {
    if (
      Object.keys(ctx.memory).length >= 40 &&
      !Object.hasOwn(ctx.memory, args.key)
    )
      throw Error("VALIDATION: scratchpad limit");
    ctx.memory[args.key] = args.value;
    return { saved: true };
  },
});
