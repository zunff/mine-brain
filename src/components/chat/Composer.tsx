"use client";

import { ArrowUp, Brain, Globe, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComposerProps {
  input: string;
  images: string[];
  streaming: boolean;
  webOn: boolean;
  deepThinkingOn: boolean;
  webAvailable: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveImage: (idx: number) => void;
  onPickFile: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSend: () => void;
  onToggleWeb: () => void;
  onToggleDeep: () => void;
}

export default function Composer({
  input,
  images,
  streaming,
  webOn,
  deepThinkingOn,
  webAvailable,
  inputRef,
  fileRef,
  onInputChange,
  onKeyDown,
  onRemoveImage,
  onPickFile,
  onUpload,
  onSend,
  onToggleWeb,
  onToggleDeep,
}: ComposerProps) {
  return (
    <div className="p-3 sm:p-4 bg-background/95 backdrop-blur border-t border-border">
      <div className="max-w-3xl mx-auto">
        {/* Image Preview strip */}
        {images.length > 0 && (
          <div className="flex items-center gap-2 mb-2 p-2 rounded-lg bg-surface border border-border overflow-x-auto">
            {images.map((img, idx) => (
              <div key={idx} className="relative group shrink-0">
                <img
                  src={img}
                  alt="preview"
                  className="h-14 w-14 rounded object-cover border border-border"
                />
                <button
                  onClick={() => onRemoveImage(idx)}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-danger text-white flex items-center justify-center text-[10px] shadow"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative rounded-2xl border border-border bg-surface focus-within:border-accent/70 focus-within:ring-1 focus-within:ring-accent/40 transition-all">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="说说你最近的纠结、重大决定或真实想法..."
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-10 text-sm text-foreground placeholder:text-muted/60 focus:outline-none max-h-44 min-h-[48px]"
          />

          <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onUpload}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={onPickFile}
                className="h-7 w-7 p-0 text-muted hover:text-foreground"
                title="上传图片/截图"
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
              {webAvailable && (
                <button
                  type="button"
                  onClick={onToggleWeb}
                  disabled={streaming}
                  aria-pressed={webOn ? "true" : "false"}
                  title="开启后回复会参考实时网络资料（标注来源，不写入你的记忆）"
                  className={cn(
                    "h-7 rounded-md px-2 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer border",
                    webOn
                      ? "bg-accent-soft border-accent/40 text-accent"
                      : "border-transparent bg-transparent text-muted hover:text-foreground hover:bg-surface-2"
                  )}
                >
                  <Globe className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">联网</span>
                </button>
              )}
              <button
                type="button"
                onClick={onToggleDeep}
                disabled={streaming}
                aria-pressed={deepThinkingOn ? "true" : "false"}
                title="开启深度思考模式：激活多维度认知探针与深度推演（localStorage 记住偏好）"
                className={cn(
                  "h-7 rounded-md px-2 text-[11px] font-medium inline-flex items-center gap-1 transition-colors cursor-pointer border",
                  deepThinkingOn
                    ? "bg-accent-soft border-accent/40 text-accent font-semibold"
                    : "border-transparent bg-transparent text-muted hover:text-foreground hover:bg-surface-2"
                )}
              >
                <Brain className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">深度思考</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="hidden md:inline text-[11px] text-muted/60">
                Shift+Enter 换行
              </span>
              <Button
                variant="primary"
                size="sm"
                onClick={onSend}
                disabled={(!input.trim() && images.length === 0) || streaming}
                className="h-8 w-8 p-0 rounded-full shrink-0"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}