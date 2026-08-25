"use client";

import { AlertCircle, Brain, Compass, HelpCircle } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";

interface ChatEmptyStateProps {
  onPrompt: (text: string) => void;
}

const STARTER_PROMPTS = [
  {
    icon: Compass,
    title: "梳理重大决定",
    desc: "我在考虑换工作/搬家/开启新项目，想权衡利弊与长远影响",
  },
  {
    icon: Brain,
    title: "反思价值冲突",
    desc: "我感觉现在的节奏和我的核心价值观有冲突，帮我看看盲点",
  },
  {
    icon: AlertCircle,
    title: "走出内耗循环",
    desc: "我又陷入了反复纠结的思维模式中，需要跳出来客观审视",
  },
  {
    icon: HelpCircle,
    title: "对照历史想法",
    desc: "看看我过去的记录，我的想法在哪些地方悄悄发生了改变？",
  },
];

export default function ChatEmptyState({ onPrompt }: ChatEmptyStateProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center max-w-xl mx-auto text-center px-4 py-8">
      <div className="mb-4 relative flex items-center justify-center">
        {/* 背景柔和呼吸微光，跟随主题 accent 色彩，完全无硬边缘与多余底框 */}
        <div
          className="absolute -inset-2 rounded-full blur-xl opacity-20 bg-accent pointer-events-none"
          aria-hidden="true"
        />
        <BrandIcon
          size={56}
          className="relative transition-transform duration-300 hover:scale-105"
        />
      </div>
      <h3 className="text-lg font-semibold text-foreground tracking-tight">
        你的个人深度思考伙伴
      </h3>
      <p className="mt-2 text-xs sm:text-sm text-muted leading-relaxed max-w-md">
        我不奉承、不迎合。我记住你的价值观、人生焦点与反复纠结，在对话中对照过去，帮你发现盲点与认知矛盾。
      </p>

      <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
        {STARTER_PROMPTS.map((item, idx) => {
          const Icon = item.icon;
          return (
            <button
              key={idx}
              onClick={() => onPrompt(item.title + "：" + item.desc)}
              className="group p-3.5 rounded-xl border border-border bg-surface hover:bg-surface-hover hover:border-accent/40 transition-all text-left flex flex-col justify-between"
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium text-foreground group-hover:text-accent transition-colors">
                  {item.title}
                </span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed line-clamp-2">{item.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}