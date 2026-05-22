import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Flame, Swords, Trophy } from "lucide-react";

type SharePayload = {
  outcome?: string;
  burnAmount?: number;
  delta?: number;
  multiplier?: number;
  bossRound?: boolean;
  bossDefeated?: boolean;
  usedItems?: string[];
  seasonPoints?: number;
  highestTokens?: number;
  currentTokens?: number;
  inventory?: {
    shield?: number;
    double?: number;
    luckyCharm?: number;
  };
  at?: string;
};

type ShareReport = {
  title: string;
  shareCode: string;
  author: string;
  createdAt: string;
  payload: SharePayload;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:4000";
const BASE_URL = import.meta.env.BASE_URL || "/";
const NORMALIZED_BASE_URL = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;

const getAppPathname = () => {
  if (typeof window === "undefined") return "/";
  const pathname = window.location.pathname || "/";
  if (
    NORMALIZED_BASE_URL &&
    NORMALIZED_BASE_URL !== "/" &&
    pathname.startsWith(NORMALIZED_BASE_URL)
  ) {
    const stripped = pathname.slice(NORMALIZED_BASE_URL.length);
    return stripped.startsWith("/") ? stripped : `/${stripped}`;
  }
  return pathname;
};

function ShareReportPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [report, setReport] = useState<ShareReport | null>(null);

  const shareCode = useMemo(() => {
    const parts = getAppPathname().split("/").filter(Boolean);
    return parts[1] || "";
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!shareCode) {
        setError("分享码无效。");
        setLoading(false);
        return;
      }
      try {
        const { data } = await axios.get<ShareReport>(`${API_BASE}/api/social/share/${shareCode}`);
        setReport(data);
      } catch {
        setError("战报不存在或已失效。");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [shareCode]);

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-14 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
          {loading ? (
            <p className="text-sm text-slate-300">加载战报中...</p>
          ) : error ? (
            <p className="text-sm text-rose-300">{error}</p>
          ) : (
            <>
              <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">
                <Flame className="h-3.5 w-3.5" />
                Burn Token Shared Report
              </p>
              <div className="rounded-2xl border border-fuchsia-300/35 bg-[radial-gradient(620px_180px_at_0%_0%,rgba(232,121,249,0.25),transparent),linear-gradient(155deg,#0a0f24_0%,#111827_65%,#1f2937_100%)] p-5 shadow-xl">
                <h1 className="text-2xl font-semibold">{report?.title}</h1>
                <p className="mt-2 text-sm text-slate-300/80">
                  来自 <span className="text-slate-100">{report?.author}</span> ·{" "}
                  {report?.createdAt ? new Date(report.createdAt).toLocaleString() : "-"}
                </p>

                <section className="mt-5 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">结果</p>
                    <p className="mt-1 inline-flex items-center gap-2 text-lg font-semibold">
                      <Trophy className="h-4 w-4 text-amber-300" />
                      {(report?.payload?.outcome || "-").toUpperCase()}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">倍率</p>
                    <p className="mt-1 text-lg font-semibold">x{report?.payload?.multiplier ?? "-"}</p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">燃烧额度</p>
                    <p className="mt-1 text-lg font-semibold">{report?.payload?.burnAmount ?? "-"} TOKENS</p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">盈亏</p>
                    <p
                      className={`mt-1 inline-flex items-center gap-2 text-lg font-semibold ${
                        (report?.payload?.delta ?? 0) >= 0 ? "text-emerald-300" : "text-rose-300"
                      }`}
                    >
                      <Swords className="h-4 w-4" />
                      {(report?.payload?.delta ?? 0) >= 0 ? "+" : ""}
                      {report?.payload?.delta ?? "-"}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">最高 Token</p>
                    <p className="mt-1 text-lg font-semibold">{report?.payload?.highestTokens ?? "-"}</p>
                  </div>
                  <div className="rounded-xl border border-white/15 bg-white/8 p-4">
                    <p className="text-xs text-slate-300/75">赛季积分</p>
                    <p className="mt-1 text-lg font-semibold">{report?.payload?.seasonPoints ?? "-"}</p>
                  </div>
                </section>

                <div className="mt-4 rounded-xl border border-white/15 bg-white/8 p-3 text-sm text-slate-200">
                  <p>
                    道具：{report?.payload?.usedItems?.length ? report.payload.usedItems.join(" / ") : "无"}
                  </p>
                  <p className="mt-1 text-xs text-slate-300/80">
                    背包：盾{report?.payload?.inventory?.shield ?? 0} 双
                    {report?.payload?.inventory?.double ?? 0} 幸运
                    {report?.payload?.inventory?.luckyCharm ?? 0}
                  </p>
                </div>
              </div>

              {report?.payload?.bossRound && (
                <p className="mt-4 rounded-lg border border-amber-300/35 bg-amber-500/15 px-3 py-2 text-sm text-amber-100">
                  {report.payload.bossDefeated ? "Boss 已击败，额外奖励已结算。" : "这是一场 Boss 回合战报。"}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

export default ShareReportPage;
