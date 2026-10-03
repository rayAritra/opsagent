import "./globals.css";
import type { ReactNode } from "react";
export const metadata = { title: "Acme company systems" };
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <strong>ACME CORP</strong>
          <nav>
            <a href="/portal">Vendor Portal</a>
            <a href="/erp">ERP</a>
            <a href="/mail">Mail</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
