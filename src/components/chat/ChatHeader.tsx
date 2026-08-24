"use client";

import { MessageSquare, PanelLeft, PanelLeftClose, Plus, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  title: string;
  sessionCount: number;
  showConsolidate: boolean;
  consolidating: boolean;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenMobileDrawer: () => void;
  onConsolidate: () => void;
  onNewChat: () => void;
}

export default function ChatHeader({
  title,
  sessionCount,
  showConsolidate,
  consolidating,
  sidebarOpen,
  onToggleSidebar,
  onOpenMobileDrawer,
  onConsolidate,
  onNewChat,
}: ChatHeaderProps) {
  return (
    <header className="h-14 border-b border-border px-4 flex items-center justify-between shrink-0 bg-surface/30 backdrop-blur-sm z-10">
      <div className="flex items-center gap-2 min-w-0">
        {/* Desktop Sidebar Toggle */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleSidebar}
          className="hidden md:flex h-8 w-8 p-0"
          title={sidebarOpen ? "折叠侧栏" : "展开侧栏"}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4 text-muted" />
          ) : (
            <PanelLeft className="h-4 w-4 text-muted" />
          )}
        </Button>

        {/* Mobile Sessions Drawer Trigger */}
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenMobileDrawer}
          className="md:hidden h-8 px-2.5 text-xs gap-1.5"
        >
          <MessageSquare className="h-3.5 w-3.5 text-accent" />
          <span>历史 ({sessionCount})</span>
        </Button>

        {/* Current Session Title */}
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-foreground truncate max-w-[180px] sm:max-w-xs md:max-w-md">
            {title}
          </h2>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {showConsolidate && (
          <Button
            variant="outline"
            size="sm"
            onClick={onConsolidate}
            disabled={consolidating}
            className="h-8 text-xs gap-1.5"
            title="提取并沉淀本次对话的重要认知与决定"
          >
            <Sparkles className={cn("h-3.5 w-3.5 text-accent", consolidating && "animate-spin")} />
            <span className="hidden sm:inline">{consolidating ? "提取中..." : "整理记忆"}</span>
          </Button>
        )}

        <Button
          variant="primary"
          size="sm"
          onClick={onNewChat}
          className="h-8 text-xs gap-1 px-2.5"
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">新对话</span>
        </Button>
      </div>
    </header>
  );
}