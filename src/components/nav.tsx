"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/resultatopgorelse", label: "Resultatopgørelse" },
  { href: "/transaktioner", label: "Transaktioner" },
  { href: "/bilag", label: "Bilag" },
  { href: "/bilag-afstemning", label: "Afstemning" },
  { href: "/import", label: "Importér" },
  { href: "/indstillinger", label: "Indstillinger" },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        <span className="font-semibold text-slate-900">Thypisk Julia</span>
        <nav className="flex gap-1 items-center">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
          <button
            onClick={logout}
            className="px-3 py-2 rounded-md text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            Log ud
          </button>
        </nav>
      </div>
    </header>
  );
}
