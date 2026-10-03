// Deterministic provider fixture for process crash testing only. Never used by the worker or evals.
import { executeRun } from "../../packages/core/src/runtime";
import { pool } from "../../packages/db/src/index";
import type { Provider } from "../../packages/core/src/llm";
const [org, id, stage] = process.argv.slice(2);
const provider: Provider = {
  json: async (_system, prompt) => {
    const input = JSON.parse(prompt) as { spec?: unknown };
    return {
      value: input.spec
        ? { steps: ["Checkpoint a note, then ask for missing input"] }
        : {
            outcome: "Exercise durable checkpoints",
            inputs: [],
            policies: [],
            criteria: ["Requester reviewed the checkpoint"],
          },
      tokens: 1,
      cost: 0,
    };
  },
  turn: async (_system, frames) => {
    const state = JSON.parse(frames[0].content) as {
      memory: Record<string, string>;
    };
    if (!state.memory.checkpoint)
      return {
        text: "Store a test note",
        call: {
          name: "memory_note",
          args: { key: "checkpoint", value: "survived crash" },
        },
        tokens: 1,
        cost: 0,
      };
    if (stage === "block") return new Promise(() => {});
    return {
      text: "Request input after restart",
      call: {
        name: "ask_human",
        args: { question: "Confirm the restored checkpoint" },
      },
      tokens: 1,
      cost: 0,
    };
  },
};
await executeRun(org, id, provider);
await pool.end();
