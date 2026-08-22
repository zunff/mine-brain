"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "对话" },
  { href: "/memories", label: "记忆" },
  { href: "/settings", label: "设置" },
];

export function SideNav() {
  const pathname = usePathname();
  if (pathname === "/onboarding") return null;
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-borderline bg-surface py-4 sm:w-40 sm:items-stretch sm:px-3">
      <div className="mb-6 hidden px-2 sm:block">
        <div className="text-sm font-semibold tracking-wide text-accent">mine-brain</div>
        <div className="mt-0.5 text-[11px] text-muted">你的思考伙伴</div>
      </div>
      <nav className="flex flex-col items-center gap-1 sm:items-stretch">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm transition-colors sm:justify-start ${
                active
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <span className="w-5 text-center text-xs opacity-80">
                {l.href === "/" ? "◇" : l.href === "/memories" ? "◈" : "◎"}
              </span>
              <span className="hidden sm:inline">{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
