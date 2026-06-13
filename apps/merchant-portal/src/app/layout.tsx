import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Community Ride — Merchant", template: "%s | Merchant Portal" },
  description: "Manage your store, products, and orders on Community Ride",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[#0f172a] text-slate-100 antialiased">{children}</body>
    </html>
  );
}
