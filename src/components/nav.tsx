"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/transaktioner", label: "Transaktioner" },
  { href: "/bilag", label: "Bilag" },
  { href: "/import", label: "Importér" },
  { href: "/indstillinger", label: "Indstillinger" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        <span className="font-semibold text-slate-900">Thypisk Julia</span>
        <nav className="flex gap-1">
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
        </nav>
      </div>
    </header>
  );
}
