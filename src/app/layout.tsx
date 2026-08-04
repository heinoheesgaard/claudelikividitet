import type { Metadata } from "next";
import "./globals.css";
import Nav from "@/components/nav";

export const metadata: Metadata = {
  title: "Business Controller",
  description: "Overblik over udgifter, indtjening og forretningsområder",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="da" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        <Nav />
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
