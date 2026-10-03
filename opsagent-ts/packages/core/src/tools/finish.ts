import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "finish",
  description:
    "Request independent verification. Claimed outcomes cannot mark a run verified.",
  schema: z.object({
    summary: z.string().max(2000),
    claimed_outcome: z.string().max(2000),
  }),
  riskTier: "READ",
  run: async (args, _ctx) => {
    return {
      requestedVerification: true,
      summary: args.summary,
      claimedOutcome: args.claimed_outcome,
    };
  },
});
