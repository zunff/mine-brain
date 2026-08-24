import {
  getOnboardingState,
  OnboardingAlreadyCompletedError,
  saveOnboarding,
  skipOnboarding,
  type OnboardingSections,
} from "@/lib/memory/onboarding";
import { listMemories } from "@/lib/memory/repo";

export const dynamic = "force-dynamic";

/** 首页引导判断用：是否有 profile + 当前画像状态。 */
export async function GET(): Promise<Response> {
  const profiles = listMemories({ type: "profile", limit: 1 });
  return Response.json({
    hasProfile: profiles.length > 0,
    onboarding: getOnboardingState(),
  });
}

interface PostBody {
  action?: "skip" | "save";
  sections?: Partial<OnboardingSections>;
  useSample?: boolean;
  /** 已完成后重建：旧 active 画像记忆归档（绝不删除） */
  force?: boolean;
}

/** 薄壳：参数透传给 lib，错误映射为 HTTP 状态。 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as PostBody | null;
  if (!body) return Response.json({ error: "invalid json" }, { status: 400 });

  if (body.action === "skip") {
    skipOnboarding();
    return Response.json({ ok: true, skipped: true });
  }

  try {
    const result = saveOnboarding(body.sections ?? {}, {
      force: body.force === true,
      useSample: body.useSample === true,
    });
    return Response.json({
      ok: true,
      count: result.count,
      archived: result.archived,
      skipped: false,
    });
  } catch (err) {
    if (err instanceof OnboardingAlreadyCompletedError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    console.error("[onboarding] save failed:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
