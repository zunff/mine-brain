"use client";

import { useCallback, useRef, useState } from "react";

/** 消息流滚动控制：跟随底部、用户主动上滑感知、「回到最新」按钮显隐。 */
export function useChatScroll() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef<boolean>(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState<boolean>(false);

  // 监听用户主动滚动事件
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNearBottom = distanceToBottom < 80;
    userScrolledUpRef.current = !isNearBottom;
    setShowScrollBottomBtn(!isNearBottom);
  }, []);

  /** 复位滚动跟随意愿与按钮（会话切换/新一轮发送前调用）。 */
  const resetScroll = useCallback(() => {
    userScrolledUpRef.current = false;
    setShowScrollBottomBtn(false);
  }, []);

  const scrollToBottom = useCallback(
    (smooth = true) => {
      resetScroll();
      const el = scrollContainerRef.current;
      if (el) {
        if (smooth) {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      }
    },
    [resetScroll],
  );

  return {
    scrollContainerRef,
    userScrolledUpRef,
    showScrollBottomBtn,
    setShowScrollBottomBtn,
    handleScroll,
    scrollToBottom,
    resetScroll,
  };
}