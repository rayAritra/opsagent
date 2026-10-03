"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
type Employee = {
  id?: string;
  name: string;
  role_prompt: string;
  allowed_tools: string[];
  policies: unknown;
  connectors: unknown;
  model: string | null;
};
type Document = { id: string; title: string; content: string };
async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as { error?: string; id?: string };
  if (!response.ok) throw Error(result.error);
  return result;
}
export function EmployeeEditor({
  employee,
  documents,
  handles,
  lessons,
  catalog,
}: {
  employee: Employee;
  documents: Document[];
  handles: { handle: string }[];
  lessons: { id: string; content: string }[];
  catalog:{name:string;risk_tier:string}[];
}) {
  const router = useRouter(),
    [value, setValue] = useState(employee),
    [policy, setPolicy] = useState(JSON.stringify(employee.policies, null, 2)),
    [connectors, setConnectors] = useState(
      JSON.stringify(employee.connectors, null, 2),
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [doc, setDoc] = useState<Document>({ id: "", title: "", content: "" }),
    [handle, setHandle] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const result = await post(
        "/api/employees" + (value.id ? "/" + value.id : ""),
        {
          ...value,
          policies: JSON.parse(policy),
          connectors: JSON.parse(connectors),
        },
      );
      if (!value.id) router.push("/employees/" + result.id);
      else {
        setMessage("Employee configuration saved.");
        router.refresh();
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PROGRAMMABLE AI EMPLOYEE</span>
          <h1>{value.id ? value.name : "Build your AI employee"}</h1>
          <p className="muted">
            Define the role, knowledge, tools, and boundaries.
          </p>
        </div>
        <Button disabled={busy} onClick={() => void save()}>
          Save employee
        </Button>
      </div>
      {message && (
        <div className="banner" role="status">
          {message}
        </div>
      )}
      <div className="run-grid">
        <div className="stack">
          <Card>
            <h2>Identity & role</h2>
            <label className="field">
              <span>Name</span>
              <input
                value={value.name}
                onChange={(e) => setValue({ ...value, name: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Role instructions</span>
              <textarea
                rows={7}
                value={value.role_prompt}
                onChange={(e) =>
                  setValue({ ...value, role_prompt: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Model override</span>
              <input
                placeholder="Uses OPSAGENT_MODEL when blank"
                value={value.model || ""}
                onChange={(e) =>
                  setValue({ ...value, model: e.target.value || null })
                }
              />
            </label>
          </Card>
          <Card>
            <h2>Allowed capabilities</h2>
            <p className="muted text-xs mb-4">
              The worker enforces this allowlist before every tool call.
              Submissions are evaluated by the policy engine.
            </p>
            <div className="tools-grid">
              {catalog.map(({name, risk_tier:risk}) => (
                <label key={name} className="tool-toggle">
                  <input
                    type="checkbox"
                    checked={value.allowed_tools.includes(name)}
                    onChange={(e) =>
                      setValue({
                        ...value,
                        allowed_tools: e.target.checked
                          ? [...value.allowed_tools, name]
                          : value.allowed_tools.filter((t) => t !== name),
                      })
                    }
                  />
                  <span className="flex-1">{name}</span>
                  <Badge tone={risk === "WRITE" ? "amber" : "neutral"}>
                    {risk}
                  </Badge>
                </label>
              ))}
            </div>
          </Card>
          {value.id && (
            <Card>
              <h2>Company knowledge</h2>
              <p className="muted text-xs">
                Markdown SOPs are retrieved using PostgreSQL full-text search,
                scoped to this employee.
              </p>
              <div className="row wrap my-4">
                {documents.map((d) => (
                  <Button
                    variant="outline"
                    size="sm"
                    key={d.id}
                    onClick={() => setDoc(d)}
                  >
                    {d.title}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDoc({ id: "", title: "", content: "" })}
                >
                  New document
                </Button>
              </div>
              <label className="field">
                <span>Title</span>
                <input
                  value={doc.title}
                  onChange={(e) => setDoc({ ...doc, title: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Markdown content</span>
                <textarea
                  rows={10}
                  value={doc.content}
                  onChange={(e) => setDoc({ ...doc, content: e.target.value })}
                />
              </label>
              <div className="row wrap">
                <input
                  type="file"
                  accept=".md,.txt"
                  aria-label="Upload knowledge markdown"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f)
                      setDoc({
                        id: "",
                        title: f.name,
                        content: await f.text(),
                      });
                  }}
                />
                <Button
                  onClick={async () => {
                    try {
                      await post(`/api/employees/${value.id}/knowledge`, {
                        ...doc,
                        id: doc.id || undefined,
                      });
                      setMessage("Knowledge saved and re-indexed.");
                      router.refresh();
                    } catch (e) {
                      setMessage(String(e));
                    }
                  }}
                >
                  Save knowledge
                </Button>
              </div>
            </Card>
          )}
          {value.id && (
            <Card>
              <h2>Learned procedures</h2>
              {!lessons.length && (
                <p className="muted">
                  Reusable lessons appear after verified runs.
                </p>
              )}
              {lessons.map((l) => (
                <Lesson key={l.id} lesson={l} />
              ))}
            </Card>
          )}
        </div>
        <div className="stack">
          <Card>
            <h2>Safety policy</h2>
            <p className="muted text-xs mb-4">
              Trusted operator configuration. External navigation is restricted
              to configured origins; sensitive writes require exact-value
              approval.
            </p>
            <textarea
              aria-label="Policy configuration JSON"
              rows={12}
              value={policy}
              onChange={(e) => setPolicy(e.target.value)}
            />
          </Card>
          <Card>
            <h2>Connectors</h2>
            <p className="muted text-xs mb-4">
              URLs and credential handles are configuration, never embedded in
              the agent.
            </p>
            <textarea
              aria-label="Connector configuration JSON"
              rows={13}
              value={connectors}
              onChange={(e) => setConnectors(e.target.value)}
            />
          </Card>
          {value.id && (
            <Card>
              <h2>Credential handles</h2>
              <div className="row wrap mb-4">
                {handles.map((h) => (
                  <Badge key={h.handle}>{h.handle}</Badge>
                ))}
              </div>
              <p className="muted text-xs mb-4">
                Secrets are encrypted with AES-256-GCM, bound to this
                organization, employee, and handle. Saved secrets are never
                returned.
              </p>
              <label className="field">
                <span>Handle</span>
                <input
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Username</span>
                <input
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Password Â· write only</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <Button
                onClick={async () => {
                  try {
                    await post(`/api/employees/${value.id}/credentials`, {
                      handle,
                      username,
                      password,
                    });
                    setPassword("");
                    setMessage("Encrypted credential saved.");
                    router.refresh();
                  } catch (e) {
                    setMessage(String(e));
                  }
                }}
              >
                Save credential
              </Button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
function Lesson({ lesson }: { lesson: { id: string; content: string } }) {
  const [content, setContent] = useState(lesson.content),
    [removed, setRemoved] = useState(false),
    [message, setMessage] = useState("");
  if (removed) return null;
  return (
    <div className="mt-4">
      <textarea value={content} onChange={(e) => setContent(e.target.value)} />
      <div className="row mt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await post("/api/lessons/" + lesson.id, { content });
              setMessage("Saved");
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          Save
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={async () => {
            try {
              await post("/api/lessons/" + lesson.id, {
                content,
                remove: true,
              });
              setRemoved(true);
            } catch (e) {
              setMessage(String(e));
            }
          }}
        >
          Delete
        </Button>
        <small>{message}</small>
      </div>
    </div>
  );
}
