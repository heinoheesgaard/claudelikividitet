import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/nav";

export const metadata: Metadata = {
  title: "Thypisk Julia",
  description: "Overblik over udgifter, indtjening, forretningsområder og bilag",
};

// Julia's UI only styles a light theme. Without this, browsers/extensions
// that auto-invert colors for dark mode break contrast on colored panels
// (e.g. the red "not found" box in bilag reconciliation).
export const viewport: Viewport = {
  colorScheme: "light",
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
