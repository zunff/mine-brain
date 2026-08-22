import React from "react";
import { cn } from "@/lib/utils";

interface BrandIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number | string;
}

/**
 * mine-brain 专属品牌标识 ——「双环思辨之印 (Reflective Mind Loop)」
 *
 * 设计意向：
 * 1. 莫比乌斯 / 双核回环：象征自我与思考伙伴的持续对话、过去认知与当下念头的互相观照对照。
 * 2. 左右半球心智流线：自然流动、克制内敛的几何线条。
 * 3. 中心交织的微芒：在对照与矛盾中碰撞出的关键「洞察」与「人生基准点」。
 */
export function BrandIcon({
  className,
  size = 24,
  ...props
}: BrandIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0 transition-transform duration-300", className)}
      {...props}
    >
      <defs>
        {/* 动态主题渐变：融合主色与微光 */}
        <linearGradient id="mb-brand-grad-primary" x1="6" y1="8" x2="42" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="1" />
          <stop offset="50%" stopColor="var(--accent)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--accent-hover, var(--accent))" stopOpacity="0.95" />
        </linearGradient>

        <linearGradient id="mb-brand-grad-glow" x1="14" y1="12" x2="34" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>

        <linearGradient id="mb-brand-grad-surface" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--surface-2)" stopOpacity="0.8" />
          <stop offset="100%" stopColor="var(--surface)" stopOpacity="0.95" />
        </linearGradient>
      </defs>

      {/* 外圈环境柔和底盘 */}
      <rect
        x="2"
        y="2"
        width="44"
        height="44"
        rx="13"
        fill="url(#mb-brand-grad-surface)"
        stroke="var(--border)"
        strokeWidth="1.2"
      />

      {/* 内部微光光晕 */}
      <circle cx="24" cy="24" r="16" fill="url(#mb-brand-grad-glow)" />

      {/* 左叶：记忆与过去的沉淀流线 */}
      <path
        d="M16 15.5C11.5 19 11 25.5 14.5 29.5C18 33.5 24 33.5 27 28.5C29.5 24.5 31.5 19 36 17.5"
        stroke="url(#mb-brand-grad-primary)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 右叶：当下反思与未来抉择的流线 */}
      <path
        d="M32 32.5C36.5 29 37 22.5 33.5 18.5C30 14.5 24 14.5 21 19.5C18.5 23.5 16.5 29 12 30.5"
        stroke="url(#mb-brand-grad-primary)"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* 核心交汇节点：洞察微芒 */}
      <circle
        cx="24"
        cy="24"
        r="2.2"
        fill="var(--accent)"
      />

      {/* 四向锚点刻度（象征人生价值观与认知基准） */}
      <circle cx="24" cy="10.5" r="1" fill="var(--accent)" opacity="0.6" />
      <circle cx="24" cy="37.5" r="1" fill="var(--accent)" opacity="0.6" />
      <circle cx="10.5" cy="24" r="1" fill="var(--accent)" opacity="0.6" />
      <circle cx="37.5" cy="24" r="1" fill="var(--accent)" opacity="0.6" />
    </svg>
  );
}
