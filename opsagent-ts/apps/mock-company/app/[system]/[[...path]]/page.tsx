import { notFound } from "next/navigation";
import { query } from "@opsagent/db";
import { requireSession, chaos } from "../../../lib/session";
import { login, createPayable, updateVendor, sendMail } from "../../actions";
export const dynamic = "force-dynamic";
type Invoice = {
  id: string;
  vendor: string;
  number: string;
  date: string;
  amount: string;
  due: string | null;
};
type Vendor = {
  id: string;
  name: string;
  domain: string;
  email: string;
  phone: string;
  notes: string;
};
type Payable = {
  id: string;
  vendor: string;
  number: string;
  amount: string;
  due: string;
  status: string;
  entered_by: string;
  notes: string;
};
type Message = {
  id: string;
  sender: string;
  recipient: string;
  subject: string;
  body: string;
  created_at: Date;
};
export default async function SystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ system: string; path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { system, path = [] } = await params;
  const sp = await searchParams;
  if (!["portal", "erp", "mail"].includes(system)) notFound();
  const route = path.join("/");
  if (route === "login")
    return (
      <main>
        <h1>{system.toUpperCase()} sign in</h1>
        {sp.error && (
          <p role="alert" className="error">
            {sp.error}
          </p>
        )}
        {sp.expired && <p>Session expired. Sign in again.</p>}
        <form action={login} data-operation="login">
          <input type="hidden" name="system" value={system} />
          <label>
            Username
            <input name="username" autoComplete="username" required />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button>Sign in</button>
          <p>Demo account: demo / demo</p>
        </form>
      </main>
    );
  await requireSession(system);
  const changed = await chaos(system);
  const error = sp.error ? (
    <p role="alert" className="error">
      {sp.error}
    </p>
  ) : null;
  if (system === "portal") {
    if (route) {
      const [p] = await query<Invoice>(
        "SELECT * FROM mock_portal.invoices WHERE id=$1",
        [route],
      );
      if (!p) notFound();
      return (
        <main>
          <a href="/portal">All invoices</a>
          <h1>{p.number}</h1>
          <dl>
            <dt>Vendor</dt>
            <dd>{p.vendor}</dd>
            <dt>Invoice date</dt>
            <dd>{p.date}</dd>
            <dt>Status</dt>
            <dd>Available</dd>
          </dl>
          <a download href={`/portal/download/${p.id}`}>
            {changed ? "Get document" : "Download PDF"}
          </a>
        </main>
      );
    }
    const q = sp.q || "",
      page = Math.max(1, Number(sp.page) || 1);
    const rows = await query<Invoice>(
      "SELECT * FROM mock_portal.invoices WHERE vendor ILIKE $1 OR number ILIKE $1 ORDER BY date DESC,number LIMIT 5 OFFSET $2",
      ["%" + q + "%", (page - 1) * 5],
    );
    const [count] = await query<{ count: string }>(
      "SELECT count(*) FROM mock_portal.invoices WHERE vendor ILIKE $1 OR number ILIKE $1",
      ["%" + q + "%"],
    );
    return (
      <main>
        <h1>Vendor invoices</h1>
        <div className="toolbar">
          <form method="get">
            <label>
              Search
              <input name="q" defaultValue={q} />
            </label>
            <button>Search</button>
          </form>
          <span>{count.count} invoices</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Invoice</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.vendor}</td>
                <td>
                  <a href={"/portal/" + p.id}>{p.number}</a>
                </td>
                <td>{p.date}</td>
                <td>Available</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pagination">
          {page > 1 && (
            <a href={`?q=${encodeURIComponent(q)}&page=${page - 1}`}>
              Previous
            </a>
          )}
          <span>Page {page}</span>
          {page * 5 < Number(count.count) && (
            <a href={`?q=${encodeURIComponent(q)}&page=${page + 1}`}>
              Next page
            </a>
          )}
        </div>
      </main>
    );
  }
  if (system === "erp") {
    if (route === "new") {
      const vendors = await query<Vendor>(
        "SELECT * FROM mock_erp.vendors ORDER BY name",
      );
      const fields = [
        <label key="vendor">
          Vendor
          <select name="vendor">
            {vendors.map((v) => (
              <option key={v.id} value={v.name}>
                {v.name}
              </option>
            ))}
          </select>
        </label>,
        <label key="number">
          Invoice number
          <input name="number" required />
        </label>,
        <label key="amount">
          Amount INR
          <input name="amount" type="number" min="0.01" step="0.01" required />
        </label>,
        <label key="due">
          Due date
          <input name="due" type="date" required />
        </label>,
      ];
      return (
        <main>
          <a href="/erp">Payables</a>
          <h1>New payable</h1>
          {error}
          <form action={createPayable} data-operation="invoice_create">
            {changed ? fields.reverse() : fields}
            <label>
              Notes
              <textarea name="notes" />
            </label>
            <button>{changed ? "Record payable" : "Create payable"}</button>
          </form>
        </main>
      );
    }
    if (route.startsWith("vendors/")) {
      const [v] = await query<Vendor>(
        "SELECT * FROM mock_erp.vendors WHERE id=$1",
        [path[1]],
      );
      if (!v) notFound();
      return (
        <main>
          <a href="/erp/vendors">Vendors</a>
          <h1>Edit {v.name}</h1>
          {error}
          <form
            action={updateVendor}
            data-operation="vendor_update"
            data-vendor-domain={v.domain}
            data-vendor-name={v.name}
          >
            <input type="hidden" name="id" value={v.id} />
            <label>
              Billing email
              <input
                name="email"
                type="email"
                defaultValue={v.email}
                required
              />
            </label>
            <label>
              Phone
              <input name="phone" defaultValue={v.phone} required />
            </label>
            <label>
              Notes
              <textarea
                name="notes"
                aria-label="Notes"
                defaultValue={v.notes}
                required
              />
            </label>
            <button>{changed ? "Apply contact changes" : "Save vendor"}</button>
          </form>
        </main>
      );
    }
    if (route === "vendors") {
      const rows = await query<Vendor>(
        "SELECT * FROM mock_erp.vendors ORDER BY name",
      );
      return (
        <main>
          <a href="/erp">Payables</a>
          <h1>Vendor directory</h1>
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Registered domain</th>
                <th>Billing email</th>
                <th>Phone</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id} data-record="vendor">
                  <td data-field="name">{v.name}</td>
                  <td data-field="domain">{v.domain}</td>
                  <td data-field="email">{v.email}</td>
                  <td data-field="phone">{v.phone}</td>
                  <td data-field="notes">{v.notes}</td>
                  <td>
                    <a href={"/erp/vendors/" + v.id}>Edit</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </main>
      );
    }
    const rows = await query<Payable>(
      "SELECT * FROM mock_erp.payables ORDER BY due,number",
    );
    return (
      <main>
        <h1>Accounts payable</h1>
        <div className="toolbar">
          <a href="/erp/new">New payable</a>
          <a href="/erp/vendors">Vendors</a>
        </div>
        <table>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Invoice number</th>
              <th>Amount INR</th>
              <th>Due date</th>
              <th>Status</th>
              <th>Entered by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} data-record="payable">
                <td data-field="vendor">{p.vendor}</td>
                <td data-field="number">{p.number}</td>
                <td data-field="amount">{p.amount}</td>
                <td data-field="due">{p.due}</td>
                <td data-field="status">{p.status}</td>
                <td>{p.entered_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    );
  }
  if (route === "compose")
    return (
      <main>
        <a href="/mail">Inbox</a>
        <h1>Compose message</h1>
        {error}
        <form action={sendMail} data-operation="mail_send">
          <label>
            To
            <input name="to" type="email" required />
          </label>
          <label>
            Subject
            <input name="subject" required />
          </label>
          <label>
            Body
            <textarea name="body" rows={12} required />
          </label>
          <button>{changed ? "Dispatch message" : "Send message"}</button>
        </form>
      </main>
    );
  if (route && route !== "sent") {
    const [m] = await query<Message>(
      "SELECT * FROM mock_mail.messages WHERE id=$1",
      [route],
    );
    if (!m) notFound();
    return (
      <main>
        <a href="/mail">Inbox</a>
        <h1>{m.subject}</h1>
        <article data-record="message">
          <dl>
            <dt>From</dt>
            <dd data-field="sender">{m.sender}</dd>
            <dt>To</dt>
            <dd data-field="recipient">{m.recipient}</dd>
            <dt>Subject</dt>
            <dd data-field="subject">{m.subject}</dd>
          </dl>
          <pre data-field="body">{m.body}</pre>
        </article>
      </main>
    );
  }
  const folder = route === "sent" ? "sent" : "inbox";
  const rows = await query<Message>(
    "SELECT * FROM mock_mail.messages WHERE folder=$1 ORDER BY created_at DESC",
    [folder],
  );
  return (
    <main>
      <h1>{folder === "sent" ? "Sent messages" : "Inbox"}</h1>
      <div className="toolbar">
        <a href="/mail">Inbox</a>
        <a href="/mail/sent">Sent</a>
        <a href="/mail/compose">Compose</a>
      </div>
      <table>
        <thead>
          <tr>
            <th>{folder === "sent" ? "To" : "From"}</th>
            <th>Subject</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td>{folder === "sent" ? m.recipient : m.sender}</td>
              <td>
                <a href={"/mail/" + m.id}>{m.subject}</a>
              </td>
              <td>{new Date(m.created_at).toISOString().slice(0, 16)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
