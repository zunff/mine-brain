"use client";

import React from "react";
import { ThemeProvider } from "./theme-context";
import { TooltipProvider } from "./ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={200}>
        {children}
      </TooltipProvider>
    </ThemeProvider>
  );
}
