/**
 * 客户端智能图片压缩工具
 *
 * 为什么必须压缩？
 * 1. 手机原图（iPhone / Android 拍摄）通常高达 12MP~48MP（4MB~15MB），Base64 膨胀后可达 20MB。
 * 2. `/api/chat` 和多模态 Vision 模型（Claude 3.7 / GPT-4o / Qwen）通常将图片缩放至 1024~1568px 网格内处理。
 * 3. 压缩后大小由 8MB 骤降至 150KB~350KB（降低 95%+），避免 SQLite 数据库膨胀、提升网络传输吞吐率并防止触发服务端体积截断。
 */

export interface CompressOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

export async function compressImageFile(
  file: File,
  options: CompressOptions = {}
): Promise<string> {
  const { maxWidth = 1536, maxHeight = 1536, quality = 0.82 } = options;

  // 如果是非图片文件，直接返回空
  if (!file.type.startsWith("image/")) {
    throw new Error("Not an image file");
  }

  // 小体积的 svg 或 ico 不需要压缩
  if (file.type === "image/svg+xml" || file.type === "image/x-icon") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { width, height } = img;

      // 等比例缩放至边界尺寸以内
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        reject(new Error("Canvas context is not available"));
        return;
      }

      // 高质量图片缩放平滑
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, width, height);

      // 默认输出标准 jpeg，有透明通道的小图可使用 png
      const isPngWithAlpha = file.type === "image/png" && file.size < 500 * 1024;
      const outputType = isPngWithAlpha ? "image/png" : "image/jpeg";
      const outputQuality = isPngWithAlpha ? undefined : quality;

      const dataUrl = canvas.toDataURL(outputType, outputQuality);
      resolve(dataUrl);
    };

    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };

    img.src = url;
  });
}
