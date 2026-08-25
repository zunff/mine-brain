"use client";

import React, { createContext, useContext, useEffect, useSyncExternalStore } from "react";

export type ThemeId = "obsidian" | "parchment" | "forest" | "roast" | "eink";

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  enName: string;
  description: string;
  bgHex: string;
  surfaceHex: string;
  accentHex: string;
  borderHex: string;
  isDark: boolean;
}

export const THEMES: ThemeMeta[] = [
  {
    id: "obsidian",
    name: "黑曜沉金",
    enName: "Obsidian Gold",
    description: "深邃曜石与微光金砂，沉静且具穿透力",
    bgHex: "#0c0c0f",
    surfaceHex: "#131317",
    accentHex: "#cbb07a",
    borderHex: "rgba(255, 255, 255, 0.08)",
    isDark: true,
  },
  {
    id: "parchment",
    name: "宋纸温墨",
    enName: "Warm Parchment",
    description: "手账温润纸色与朱砂温墨，书房典雅阅读质感",
    bgHex: "#f7f4ed",
    surfaceHex: "#ede7da",
    accentHex: "#a84328",
    borderHex: "rgba(90, 70, 50, 0.12)",
    isDark: false,
  },
  {
    id: "forest",
    name: "冷杉寒林",
    enName: "Nordic Forest",
    description: "宁静深苔与松针青绿，抚平思绪焦虑，适合长夜深思",
    bgHex: "#070e0d",
    surfaceHex: "#0e1816",
    accentHex: "#58a88f",
    borderHex: "rgba(255, 255, 255, 0.07)",
    isDark: true,
  },
  {
    id: "roast",
    name: "琥珀深焙",
    enName: "Tokyo Roast",
    description: "深焙咖啡豆与原木暖调，温暖且富有包容感",
    bgHex: "#0f0c0b",
    surfaceHex: "#171311",
    accentHex: "#cb814c",
    borderHex: "rgba(255, 255, 255, 0.07)",
    isDark: true,
  },
  {
    id: "eink",
    name: "素宣水墨",
    enName: "E-Ink Monochrome",
    description: "纯净墨水屏质感，剔除所有色彩杂质，专注纯粹思维",
    bgHex: "#fbfbfb",
    surfaceHex: "#f1f1ee",
    accentHex: "#161616",
    borderHex: "rgba(0, 0, 0, 0.1)",
    isDark: false,
  },
];

interface ThemeContextType {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  themes: ThemeMeta[];
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "obsidian",
  setTheme: () => {},
  themes: THEMES,
});

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener("mb_theme_change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("mb_theme_change", callback);
  };
}

function getThemeSnapshot(): ThemeId {
  if (typeof window === "undefined") return "obsidian";
  try {
    const saved = localStorage.getItem("mb_theme") as ThemeId;
    if (saved && THEMES.some((t) => t.id === saved)) {
      return saved;
    }
  } catch {
    // ignore
  }
  return "obsidian";
}

function getServerSnapshot(): ThemeId {
  return "obsidian";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerSnapshot);

  // 保证主题切换时 document.documentElement 上的 data-theme 永远与状态同步
  useEffect(() => {
    try {
      document.documentElement.setAttribute("data-theme", theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const setTheme = (nextTheme: ThemeId) => {
    try {
      localStorage.setItem("mb_theme", nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);
      window.dispatchEvent(new Event("mb_theme_change"));
    } catch {
      // ignore
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
