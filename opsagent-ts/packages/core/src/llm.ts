import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { env } from "@opsagent/db";
import type { Call, Frame } from "./types";
export type Definition = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};
export type Reply = { text: string; call?: Call; tokens: number; cost: number };
export interface Provider {
  turn(system: string, frames: Frame[], tools: Definition[]): Promise<Reply>;
  json(
    system: string,
    prompt: string,
  ): Promise<{ value: unknown; tokens: number; cost: number }>;
}
export function providerAvailable() {
  return Boolean(
    env.OPSAGENT_PROVIDER === "anthropic"
      ? env.ANTHROPIC_API_KEY
      : env.OPENAI_API_KEY,
  );
}
export function createProvider(model = env.OPSAGENT_MODEL): Provider {
  if (!providerAvailable())
    throw Error(
      `Missing ${env.OPSAGENT_PROVIDER === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY"}. App development works without a key; autonomous execution does not.`,
    );
  const anthropic =
    env.OPSAGENT_PROVIDER === "anthropic"
      ? new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          maxRetries: 2,
          timeout: 120000,
        })
      : undefined;
  const openai = !anthropic
    ? new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        baseURL: env.OPENAI_BASE_URL,
        maxRetries: 2,
        timeout: 120000,
      })
    : undefined;
  async function turn(
    system: string,
    frames: Frame[],
    tools: Definition[],
  ): Promise<Reply> {
    if (anthropic) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 2200,
        system,
        messages: frames.map((f) => ({ role: f.role, content: f.content })),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
        ...(tools.length
          ? {
              tool_choice: {
                type: "auto" as const,
                disable_parallel_tool_use: true,
              },
            }
          : {}),
      });
      const content = response.content;
      const text = content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const tool = content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const input = response.usage.input_tokens,
        output = response.usage.output_tokens;
      return {
        text,
        call: tool
          ? { name: tool.name, args: tool.input as Record<string, unknown> }
          : undefined,
        tokens: input + output,
        cost: (input * 2 + output * 10) / 1e6,
      };
    }
    if (!openai) throw Error("Provider unavailable");
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "system", content: system }, ...frames],
      ...(tools.length
        ? {
            tools: tools.map((t) => ({
              type: "function" as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema,
              },
            })),
            parallel_tool_calls: false,
          }
        : {}),
    });
    const m = response.choices[0].message;
    const tool = m.tool_calls?.[0];
    const call =
      tool && tool.type === "function"
        ? {
            name: tool.function.name,
            args: JSON.parse(tool.function.arguments) as Record<
              string,
              unknown
            >,
          }
        : undefined;
    return {
      text: m.content || "",
      call,
      tokens: response.usage?.total_tokens || 0,
      cost: 0,
    };
  }
  return {
    turn,
    json: async (system, prompt) => {
      const r = await turn(
        system + "\nReturn a single JSON value. No markdown.",
        [{ role: "user", content: prompt }],
        [],
      );
      const cleaned = r.text
        .trim()
        .replace(/^```(?:json)?\s*/, "")
        .replace(/\s*```$/, "");
      return {
        value: JSON.parse(cleaned) as unknown,
        tokens: r.tokens,
        cost: r.cost,
      };
    },
  };
}
