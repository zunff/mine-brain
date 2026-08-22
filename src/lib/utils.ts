import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** fetch 后校验 HTTP 状态；失败抛出带后端 error 信息的异常（调用方 catch 后展示）。 */
export async function assertOk(res: Response): Promise<unknown> {
  if (res.ok) return res.json().catch(() => null);
  const data = await res.json().catch(() => null);
  throw new Error((data as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
}
