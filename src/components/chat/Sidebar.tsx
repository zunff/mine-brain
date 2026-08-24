"use client";

import { Edit3, MessageSquare, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Session } from "./types";

interface SidebarProps {
  sidebarOpen: boolean;
  mobileDrawerOpen: boolean;
  sessions: Session[];
  filteredSessions: Session[];
  currentSessionId: string | null;
  searchQuery: string;
  onSetMobileDrawer: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onNewChat: () => void;
  onSelectSession: (id: string) => void;
  onOpenRename: (s: Session) => void;
  onOpenDelete: (s: Session) => void;
  onOpenRenameMobile: (s: Session) => void;
  onOpenDeleteMobile: (s: Session) => void;
}

export default function Sidebar({
  sidebarOpen,
  mobileDrawerOpen,
  sessions,
  filteredSessions,
  currentSessionId,
  searchQuery,
  onSetMobileDrawer,
  onSearchChange,
  onNewChat,
  onSelectSession,
  onOpenRename,
  onOpenDelete,
  onOpenRenameMobile,
  onOpenDeleteMobile,
}: SidebarProps) {
  return (
    <>
      {/* Desktop Session Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r border-border bg-surface/50 transition-all duration-200 shrink-0",
          sidebarOpen ? "w-64" : "w-0 overflow-hidden border-none"
        )}
      >
        <div className="p-3 border-b border-border space-y-2">
          <Button
            onClick={onNewChat}
            className="w-full justify-start gap-2 h-9"
            variant="primary"
          >
            <Plus className="h-4 w-4" />
            <span>开启新思考</span>
          </Button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="搜索历史对话..."
              className="w-full rounded-md border border-border bg-surface pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredSessions.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted">
              {searchQuery ? "未找到相关对话" : "暂无对话记录"}
            </div>
          ) : (
            filteredSessions.map((s) => {
              const isActive = s.id === currentSessionId;
              return (
                <div
                  key={s.id}
                  onClick={() => onSelectSession(s.id)}
                  className={cn(
                    "group relative flex items-center justify-between rounded-lg px-3 py-2 text-xs cursor-pointer transition-colors",
                    isActive
                      ? "bg-accent-soft text-foreground font-medium border border-accent/25"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                    <MessageSquare
                      className={cn("h-3.5 w-3.5 shrink-0", isActive ? "text-accent" : "text-muted")}
                    />
                    <span className="truncate">{s.title || "无标题对话"}</span>
                  </div>

                  {/* Actions */}
                  <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenRename(s);
                      }}
                      className="p-1 rounded hover:bg-surface text-muted hover:text-foreground"
                      title="重命名"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenDelete(s);
                      }}
                      className="p-1 rounded hover:bg-danger-soft text-muted hover:text-danger"
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Mobile Sessions Drawer */}
      <Dialog open={mobileDrawerOpen} onOpenChange={onSetMobileDrawer}>
        <DialogContent className="max-w-md w-[92vw] p-5">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-accent" />
              <span>历史对话</span>
              <span className="text-xs font-normal text-muted">({sessions.length})</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 mt-1">
            <Button
              size="sm"
              variant="primary"
              onClick={onNewChat}
              className="w-full justify-center gap-1.5 h-9 font-medium"
            >
              <Plus className="h-4 w-4" />
              <span>开启新对话</span>
            </Button>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="搜索历史对话..."
                className="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 my-3 pr-1">
            {filteredSessions.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted">暂无历史记录</div>
            ) : (
              filteredSessions.map((s) => {
                const isActive = s.id === currentSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => onSelectSession(s.id)}
                    className={cn(
                      "flex items-center justify-between rounded-lg p-3 text-xs cursor-pointer",
                      isActive
                        ? "bg-accent-soft text-accent font-medium border border-accent/30"
                        : "bg-surface text-foreground hover:bg-surface-2"
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{s.title || "无标题对话"}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenRenameMobile(s);
                        }}
                        className="p-1.5 rounded hover:bg-surface-2 text-muted"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenDeleteMobile(s);
                        }}
                        className="p-1.5 rounded hover:bg-danger-soft text-muted hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}