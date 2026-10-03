import type { ReactNode } from "react";
import Link from "next/link";
import {
  Command,
  Inbox,
  Users,
  ShieldCheck,
  FlaskConical,
  ArrowUpRight,
} from "lucide-react";
import { ThemeToggle } from "./theme";
import { logout } from "../app/actions";
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside>
        <Link href="/" className="brand">
          <span className="brand-mark">O</span>OpsAgent
          <span className="brand-label">WORKSPACE</span>
        </Link>
        <div className="workspace">
          <span className="avatar">AC</span>
          <div>
            <strong>Acme Corp</strong>
            <small>Operations workspace</small>
          </div>
          <span className="online" />
        </div>
        <div className="nav-label">OPERATE</div>
        <nav>
          <Link href="/">
            <Command size={18} />
            Command center
          </Link>
          <Link href="/inbox">
            <Inbox size={18} />
            Human inbox
          </Link>
          <Link href="/employees">
            <Users size={18} />
            AI employees
          </Link>
          <Link href="/audit">
            <ShieldCheck size={18} />
            Audit trail
          </Link>
          <Link href="/evals">
            <FlaskConical size={18} />
            Evaluations
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <a href="http://127.0.0.1:3001" target="_blank" rel="noreferrer">
            Company sandbox
            <ArrowUpRight size={15} />
          </a>
          <div className="profile">
            <span className="avatar">OP</span>
            <div>
              <strong>Demo operator</strong>
              <small>Workspace administrator</small>
            </div>
            <ThemeToggle />
          </div>
          <form action={logout}>
            <button className="muted">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <span>
            WORKSPACE <span className="muted">/ Acme Corp</span>
          </span>
          <div>
            <span className="online" /> Sandbox environment
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
