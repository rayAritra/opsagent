import { z } from "zod";
import { defineTool } from "./define";

export default defineTool({
  name: "browser_login",
  description: "Sign in to a configured connector without exposing its secret.",
  schema: z.object({ system: z.string(), credential_handle: z.string() }),
  riskTier: "READ",
  run: async (args, ctx) => {
    return ctx.browser.login(args.system, args.credential_handle);
  },
});
