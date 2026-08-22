"use client";

import React from "react";
import { Palette, Check } from "lucide-react";
import { useTheme } from "./theme-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function ThemeSwitcher({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { theme, setTheme, themes } = useTheme();
  const currentTheme = themes.find((t) => t.id === theme) || themes[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-foreground hover:bg-surface-2 transition-colors border border-borderline/60 focus:outline-none cursor-pointer"
          title="切换视觉主题"
        >
          <span
            className="w-3 h-3 rounded-full border border-borderline shadow-xs flex-shrink-0"
            style={{ backgroundColor: currentTheme.accentHex }}
          />
          {!compact && <span>{currentTheme.name}</span>}
          <Palette className="w-3.5 h-3.5 ml-auto opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>视觉主题 · 5套风格</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {themes.map((t) => {
          const isSelected = t.id === theme;
          return (
            <DropdownMenuItem
              key={t.id}
              onClick={() => setTheme(t.id)}
              className="flex items-center justify-between gap-3 py-2 cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 shadow-inner"
                  style={{
                    backgroundColor: t.bgHex,
                    borderColor: t.borderHex,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: t.accentHex }}
                  />
                </div>
                <div className="flex flex-col min-w-0 text-left">
                  <span className="text-xs font-medium truncate">
                    {t.name}
                  </span>
                  <span className="text-[10px] text-muted truncate">
                    {t.enName}
                  </span>
                </div>
              </div>
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
