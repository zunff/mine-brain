"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Session } from "./types";

interface SessionDialogsProps {
  renameTarget: Session | null;
  renameTitle: string;
  deleteTarget: Session | null;
  onRenameChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onDeleteSubmit: () => void;
  onDeleteCancel: () => void;
}

export default function SessionDialogs({
  renameTarget,
  renameTitle,
  deleteTarget,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onDeleteSubmit,
  onDeleteCancel,
}: SessionDialogsProps) {
  return (
    <>
      {/* Rename Session Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && onRenameCancel()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>为这段思考指定一个清晰的标题</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <input
              value={renameTitle}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onRenameSubmit()}
              placeholder="输入对话标题..."
              autoFocus
              className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onRenameCancel}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={onRenameSubmit}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Session Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && onDeleteCancel()}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除对话</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title}」吗？对话中的消息将无法恢复（已提取至记忆库的内容仍会保留）。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onDeleteCancel}>
              取消
            </Button>
            <Button variant="danger" size="sm" onClick={onDeleteSubmit}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}