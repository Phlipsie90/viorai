import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "Sicherheitsleistungen – Angebotssystem",
  description: "Angebotstool für Sicherheitsdienstleistungen",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full">
      <body className="h-full">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
