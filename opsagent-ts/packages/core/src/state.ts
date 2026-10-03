import type { State } from "./types";
const graph: Record<State, State[]> = {
  QUEUED: ["UNDERSTANDING", "FAILED", "CANCELLED"],
  UNDERSTANDING: [
    "PLANNING",
    "AWAITING_INPUT",
    "FAILED",
    "ESCALATED",
    "CANCELLED",
  ],
  PLANNING: ["EXECUTING", "FAILED", "ESCALATED", "CANCELLED"],
  EXECUTING: [
    "AWAITING_APPROVAL",
    "AWAITING_INPUT",
    "VERIFYING",
    "PLANNING",
    "FAILED",
    "ESCALATED",
    "CANCELLED",
  ],
  AWAITING_APPROVAL: ["EXECUTING", "CANCELLED", "FAILED"],
  AWAITING_INPUT: ["UNDERSTANDING", "EXECUTING", "CANCELLED", "FAILED"],
  VERIFYING: ["COMPLETED", "EXECUTING", "ESCALATED", "FAILED", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  ESCALATED: [],
  CANCELLED: [],
};
export function canTransition(from: State, to: State) {
  return from === to || graph[from].includes(to);
}
export function assertTransition(from: State, to: State) {
  if (!canTransition(from, to))
    throw Error(`Invalid run transition ${from} -> ${to}`);
}
export const terminal = (s: State) =>
  ["COMPLETED", "FAILED", "ESCALATED", "CANCELLED"].includes(s);
