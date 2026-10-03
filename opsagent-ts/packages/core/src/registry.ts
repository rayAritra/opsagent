import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { projectRoot } from "@opsagent/db";
import type { Tool, ToolContext } from "./tools/define";
import type { Call, Result } from "./types";
import type { Definition } from "./llm";
export class Registry {
  readonly tools = new Map<string, Tool>();
  static async load() {
    const registry = new Registry();
    const folder = resolve(projectRoot, "packages/core/src/tools");
    for (const file of (await readdir(folder))
      .filter((f) => f.endsWith(".ts") && f !== "define.ts")
      .sort()) {
      const module = (await import(
        pathToFileURL(resolve(folder, file)).href
      )) as { default: Tool };
      registry.tools.set(module.default.name, module.default);
    }
    return registry;
  }
  definitions(allowed: string[]): Definition[] {
    return [...this.tools.values()]
      .filter((t) => allowed.includes(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: zodToJsonSchema(t.schema, {
          $refStrategy: "none",
        }) as Record<string, unknown>,
      }));
  }
  async execute(call: Call, context: ToolContext): Promise<Result> {
    if (!context.employee.allowed_tools.includes(call.name))
      return {
        ok: false,
        error: "Tool not allowed for employee",
        errorType: "PERMISSION_DENIED",
      };
    const tool = this.tools.get(call.name);
    if (!tool)
      return { ok: false, error: "Unknown tool", errorType: "VALIDATION" };
    return tool.execute(call.args, context);
  }
}
