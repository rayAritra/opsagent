// Scripted native-call adapter ONLY for exercising runtime mechanics without a paid API key.
// It is not imported by production code and does not count toward eval success.
import type { Provider } from "../../packages/core/src/llm";
import type { Employee, Call } from "../../packages/core/src/types";
export function invoiceProvider(
  employee: Employee,
  source: {
    id: string;
    vendor: string;
    number: string;
    amount: string;
    due: string;
  },
): Provider {
  let index = 0;
  const actions: (Call | ((state: Record<string, unknown>) => Call))[] = [
    {
      name: "browser_login",
      args: {
        system: "portal",
        credential_handle: employee.connectors.portal.credentialHandle,
      },
    },
    {
      name: "browser_navigate",
      args: { url: employee.connectors.portal.url + "/" + source.id },
    },
    (state) => ({
      name: "browser_download",
      args: { id: element(state, "Download PDF") },
    }),
    (state) => {
      const history = state.history as { content: string }[];
      let file = "";
      for (const frame of history) {
        try {
          const summary = JSON.parse(frame.content) as {
            toolResultSummary?: string;
          };
          if (summary.toolResultSummary) {
            const result = JSON.parse(summary.toolResultSummary) as {
              data?: { file?: string };
            };
            if (result.data?.file) file = result.data.file;
          }
        } catch {
          /* Not every history frame is a tool result. */
        }
      }
      return { name: "pdf_extract", args: { file } };
    },
    {
      name: "browser_login",
      args: {
        system: "erp",
        credential_handle: employee.connectors.erp.credentialHandle,
      },
    },
    {
      name: "browser_navigate",
      args: { url: employee.connectors.erp.url + "/new" },
    },
    (state) => ({
      name: "browser_select",
      args: { id: element(state, "Vendor"), value: source.vendor },
    }),
    (state) => ({
      name: "browser_type",
      args: { id: element(state, "Invoice number"), text: source.number },
    }),
    (state) => ({
      name: "browser_type",
      args: { id: element(state, "Amount INR"), text: source.amount },
    }),
    (state) => ({
      name: "browser_type",
      args: { id: element(state, "Due date"), text: source.due },
    }),
    (state) => ({
      name: "browser_click",
      args: { id: element(state, "Create payable") },
    }),
  ];
  return {
    json: async (system) => {
      if (system.includes("independent verifier"))
        return {
          value: {
            checks: [
              {
                criterion: 0,
                system: "erp",
                kind: "payable",
                match: { vendor: source.vendor, number: source.number },
                expected: {
                  vendor: source.vendor,
                  number: source.number,
                  amount: source.amount,
                  due: source.due,
                },
                sourcePdf: source.number + ".pdf",
                absent: false,
              },
            ],
            reason:
              "Real fresh-browser comparison proposed by a fixture provider",
          },
          tokens: 1,
          cost: 0,
        };
      if (system.includes("procedural lessons"))
        return { value: { lessons: [] }, tokens: 1, cost: 0 };
      if (system.includes("intent-level plan"))
        return {
          value: {
            steps: [
              "Read source PDF",
              "Create a payable with approval",
              "Independently verify fields",
            ],
          },
          tokens: 1,
          cost: 0,
        };
      return {
        value: {
          outcome: "A matching invoice payable",
          inputs: [],
          policies: [
            {
              rule: "Approval above threshold",
              citation: "invoice_processing.md",
            },
          ],
          criteria: [
            "The source invoice appears exactly once with matching vendor, number, amount and due date",
          ],
        },
        tokens: 1,
        cost: 0,
      };
    },
    turn: async (_system, frames) => {
      const state = JSON.parse(frames[0].content) as Record<string, unknown>;
      const next = actions[index++];
      return {
        text: "Deterministic mechanics fixture",
        call: next
          ? typeof next === "function"
            ? next(state)
            : next
          : {
              name: "finish",
              args: {
                summary: "Request fresh verification",
                claimed_outcome: "Do not trust this actor claim",
              },
            },
        tokens: 1,
        cost: 0,
      };
    },
  };
}
function element(state: Record<string, unknown>, label: string) {
  const observation = state.observation as { elements?: string[] };
  const found = observation.elements?.find((s) => s.includes(label));
  if (!found) throw Error("Fixture element unavailable: " + label);
  return Number(/\[(\d+)\]/.exec(found)?.[1]);
}
