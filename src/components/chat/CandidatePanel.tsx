"use client";

import { Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Candidate } from "./types";

interface CandidatePanelProps {
  candidates: Candidate[];
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  onDismiss: () => void;
}

export default function CandidatePanel({
  candidates,
  onApprove,
  onReject,
  onDismiss,
}: CandidatePanelProps) {
  if (candidates.length === 0) return null;
  return (
    <div className="my-6 p-4 rounded-xl border border-accent/40 bg-accent-soft/40 animate-in fade-in">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-accent">
          <Sparkles className="h-4 w-4" />
          <span>本次对话的记忆候选（确认后入库）</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss} className="h-6 w-6 p-0">
          <X className="h-3.5 w-3.5 text-muted" />
        </Button>
      </div>
      <div className="space-y-2 mt-3">
        {candidates.map((c) => (
          <div key={c.id} className="p-2.5 rounded-lg bg-surface border border-border text-xs">
            <div className="flex items-center gap-1.5 text-muted mb-1">
              <Badge variant="accent" className="text-[10px] py-0 px-1.5">
                {c.type}
              </Badge>
              {c.title && <span className="font-medium text-foreground">{c.title}</span>}
            </div>
            <p className="text-muted leading-relaxed text-[11px] whitespace-pre-wrap">
              {c.content}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => onApprove(c.id)}
                className="h-6 px-2.5 text-[11px]"
              >
                <Check className="h-3 w-3 mr-1" />
                确认
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReject(c.id)}
                className="h-6 px-2.5 text-[11px] text-muted hover:text-danger"
              >
                拒绝
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}