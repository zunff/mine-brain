"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressImageFile } from "@/lib/image-compress";

/** 输入区状态：文本/图片/编辑态，附图片压缩上传与 textarea 自动撑高。 */
export function useChatComposer(onImageError?: () => void) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onImageErrorRef = useRef(onImageError);
  useEffect(() => {
    onImageErrorRef.current = onImageError;
  });

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // 输入变化即退出编辑态（用户修改后就不是「原样重发」了）
  const changeInput = useCallback((v: string) => {
    setInput(v);
    setEditingIndex(null);
  }, []);

  const clearComposer = useCallback(() => {
    setInput("");
    setImages([]);
  }, []);

  /** 进入编辑态：回填内容并聚焦。 */
  const startEdit = useCallback((msgIndex: number, content: string, imgs?: string[]) => {
    setEditingIndex(msgIndex);
    setInput(content);
    if (imgs && imgs.length > 0) setImages(imgs);
    textareaRef.current?.focus();
  }, []);

  const handleImageUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const compressedDataUrl = await compressImageFile(file, {
          maxWidth: 1536,
          maxHeight: 1536,
          quality: 0.82,
        });
        setImages((prev) => [...prev, compressedDataUrl]);
      } catch {
        onImageErrorRef.current?.();
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const pickFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    input,
    setInput,
    images,
    setImages,
    editingIndex,
    setEditingIndex,
    changeInput,
    clearComposer,
    startEdit,
    handleImageUpload,
    removeImage,
    pickFile,
    textareaRef,
    fileInputRef,
  };
}