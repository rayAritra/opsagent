"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
export function CommandBar({
  employees,
  enabled,
}: {
  employees: { id: string; name: string }[];
  enabled: boolean;
}) {
  const router = useRouter(),
    [task, setTask] = useState(""),
    [employee, setEmployee] = useState(employees[0]?.id || ""),
    [chaos, setChaos] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Card className="command">
      <div className="row">
        <ShieldCheck size={17} className="muted" />
        <span className="stat-label">Delegate an operation</span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const response = await fetch("/api/runs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ task, employeeId: employee, chaos }),
            });
            const data = (await response.json()) as {
              id?: string;
              error?: string;
            };
            if (!response.ok) throw Error(data.error);
            router.push("/runs/" + data.id);
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          aria-label="Task request"
          placeholder="What would you like your AI employee to handle?"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          required
        />
        <div className="command-footer">
          <div className="row wrap">
            <select
              aria-label="AI employee"
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
            <label className="switch">
              <input
                type="checkbox"
                checked={chaos}
                onChange={(e) => setChaos(e.target.checked)}
              />
              Chaos mode
            </label>
          </div>
          <Button disabled={busy || !enabled || !employee}>
            {busy ? "Starting…" : "Run task"}
            <ArrowUp size={16} className="ml-2" />
          </Button>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
      <small className="mt-3">
        Sensitive actions wait for approval. Completion requires independent
        verification.
      </small>
    </Card>
  );
}
