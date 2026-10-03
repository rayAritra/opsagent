import "./globals.css";
import type { ReactNode } from "react";
export const metadata = {
  title: "OpsAgent · Operations workspace",
  description:
    "Configurable AI employees with durable execution, human approvals, and independently verified outcomes.",
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
