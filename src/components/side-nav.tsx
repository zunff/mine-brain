"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Compass, Sliders } from "lucide-react";
import { ThemeSwitcher } from "./theme-switcher";
import { BrandIcon } from "./brand-icon";

const LINKS = [
  { href: "/", label: "对话", icon: MessageSquare, desc: "思考伙伴" },
  { href: "/memories", label: "记忆", icon: Compass, desc: "长程图谱" },
  { href: "/settings", label: "设置", icon: Sliders, desc: "模型与配置" },
];

export function SideNav() {
  const pathname = usePathname();
  if (pathname === "/onboarding") return null;

  return (
    <>
      {/* Desktop Sidebar (md+) */}
      <aside className="hidden md:flex w-56 shrink-0 flex-col justify-between border-r border-borderline bg-surface p-4 select-none">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2.5 px-2">
            <BrandIcon size={32} />
            <div>
              <div className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                mine-brain
              </div>
              <div className="text-[11px] text-muted">个人深度思考伙伴</div>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {LINKS.map((l) => {
              const active = pathname === l.href;
              const Icon = l.icon;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-accent-soft text-accent shadow-xs"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 transition-transform duration-150 group-hover:scale-110 ${
                      active ? "text-accent" : "text-muted group-hover:text-foreground"
                    }`}
                  />
                  <span>{l.label}</span>
                  {active && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent animate-pulse-subtle" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3 pt-4 border-t border-borderline/60">
          <div className="px-1 text-[11px] text-muted flex items-center justify-between">
            <span>主题风格</span>
          </div>
          <ThemeSwitcher />
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar (<md) */}
      <nav className="flex md:hidden shrink-0 border-t border-borderline bg-surface/95 backdrop-blur-md px-3 py-1.5 justify-around items-center z-40">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          const Icon = l.icon;
          return (
            <Link
              key={l.href}
              href={l.href}
              className={`flex flex-col items-center justify-center gap-1 py-1 px-4 rounded-xl transition-all ${
                active
                  ? "text-accent font-medium"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                  active ? "bg-accent-soft text-accent" : ""
                }`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <span className="text-[11px]">{l.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
