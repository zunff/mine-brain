"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface PairDeleteTarget {
  userIdx: number;
  assistantIdx: number;
  question: string;
  answer: string;
}

interface PairDeleteDialogProps {
  target: PairDeleteTarget | null;
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 删除某一轮问答前的确认：预览问题与回答，并明确「不再进入后续对话上下文」。 */
export default function PairDeleteDialog({
  target,
  deleting,
  onConfirm,
  onCancel,
}: PairDeleteDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && !deleting && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-danger" />
            <span>删除这一轮问答？</span>
          </DialogTitle>
          <DialogDescription className="space-y-3 pt-1 text-xs">
            <div className="space-y-1.5">
              <div className="rounded-lg bg-surface-2/70 border border-border p-2.5">
                <div className="text-[10px] text-muted mb-1">你的问题</div>
                <div className="text-[13px] text-foreground whitespace-pre-wrap line-clamp-3 leading-relaxed">
                  {target?.question || "…"}
                </div>
              </div>
              <div className="rounded-lg bg-surface/80 border border-border/70 p-2.5">
                <div className="text-[10px] text-muted mb-1">伙伴的回答</div>
                <div className="text-[13px] text-foreground whitespace-pre-wrap line-clamp-3 leading-relaxed">
                  {target?.answer || "（空）"}
                </div>
              </div>
            </div>
            <p className="text-muted leading-relaxed">
              删除后这一问一答将<span className="text-foreground font-medium">不再进入后续对话的上下文</span>
              （包括重新思考时提供给模型的上文）；已提炼至记忆库的长期记忆不受影响。
            </p>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={deleting}>
            取消
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} disabled={deleting}>
            {deleting ? "删除中..." : "确认删除"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}