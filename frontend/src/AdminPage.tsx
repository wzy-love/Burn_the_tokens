import { useState } from "react";
import axios from "axios";

type AdminConfig = {
  jackpotScale: number;
  winScale: number;
  newPlayerBoostScale: number;
  loginRewardScale: number;
};

type AdminMetrics = {
  totalPlayers: number;
  bannedPlayers: number;
  dau: number;
  retentionEstimate: number;
  burnsToday: number;
  tokenSupply: number;
  simulatedPayers: number;
  simulatedRevenue: number;
};

type AdminOverview = {
  runtimeConfig: AdminConfig;
  metrics: AdminMetrics;
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:4000";

function AdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [config, setConfig] = useState<AdminConfig>({
    jackpotScale: 1,
    winScale: 1,
    newPlayerBoostScale: 1,
    loginRewardScale: 1
  });
  const [compAmount, setCompAmount] = useState(100);
  const [compPlayerId, setCompPlayerId] = useState("");
  const [banPlayerId, setBanPlayerId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const withKey = { key: adminKey };

  const loadOverview = async () => {
    try {
      setError("");
      const { data } = await axios.get<AdminOverview>(`${API_BASE}/api/admin/overview`, {
        params: { key: adminKey }
      });
      setOverview(data);
      setConfig(data.runtimeConfig);
      setMessage("后台数据已刷新");
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "加载失败")
        : "加载失败";
      setError(msg);
    }
  };

  const saveConfig = async () => {
    try {
      setError("");
      await axios.post(`${API_BASE}/api/admin/config`, {
        ...withKey,
        config
      });
      setMessage("参数已更新");
      await loadOverview();
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "更新失败")
        : "更新失败";
      setError(msg);
    }
  };

  const sendCompensation = async () => {
    try {
      setError("");
      await axios.post(`${API_BASE}/api/admin/compensate`, {
        ...withKey,
        amount: compAmount,
        playerId: compPlayerId.trim() || undefined
      });
      setMessage("补偿已发送");
      await loadOverview();
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "补偿失败")
        : "补偿失败";
      setError(msg);
    }
  };

  const resetSeason = async () => {
    try {
      setError("");
      await axios.post(`${API_BASE}/api/admin/season/reset`, withKey);
      setMessage("赛季已重置");
      await loadOverview();
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "重置失败")
        : "重置失败";
      setError(msg);
    }
  };

  const banPlayer = async (banned: boolean) => {
    try {
      setError("");
      await axios.post(`${API_BASE}/api/admin/ban`, {
        ...withKey,
        playerId: banPlayerId,
        banned
      });
      setMessage(banned ? "玩家已封禁" : "玩家已解封");
      await loadOverview();
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "操作失败")
        : "操作失败";
      setError(msg);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-3xl font-semibold">Admin Console</h1>
        <div className="rounded-xl border border-white/15 bg-white/5 p-4">
          <p className="mb-2 text-sm text-slate-300">管理密钥</p>
          <div className="flex gap-2">
            <input
              value={adminKey}
              onChange={(event) => setAdminKey(event.target.value)}
              className="flex-1 rounded-lg border border-white/20 bg-slate-900/60 px-3 py-2 text-sm"
              placeholder="输入 ADMIN_KEY"
            />
            <button
              type="button"
              onClick={loadOverview}
              className="rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-2 text-sm"
            >
              刷新
            </button>
          </div>
          {message && <p className="mt-2 text-xs text-emerald-300">{message}</p>}
          {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        </div>

        {overview && (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              {Object.entries(overview.metrics).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-white/15 bg-white/5 p-3 text-sm">
                  <p className="text-slate-300">{key}</p>
                  <p className="mt-1 text-lg font-semibold">{String(value)}</p>
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-white/15 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-medium">调概率参数</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {Object.entries(config).map(([key, value]) => (
                  <label key={key} className="text-sm">
                    <span className="mb-1 block text-slate-300">{key}</span>
                    <input
                      type="number"
                      step="0.05"
                      value={value}
                      onChange={(event) =>
                        setConfig((prev) => ({ ...prev, [key]: Number(event.target.value) }))
                      }
                      className="w-full rounded-lg border border-white/20 bg-slate-900/60 px-3 py-2"
                    />
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={saveConfig}
                className="mt-3 rounded-lg border border-indigo-300/40 bg-indigo-500/20 px-3 py-2 text-sm"
              >
                保存参数
              </button>
            </section>

            <section className="rounded-xl border border-white/15 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-medium">发补偿</h2>
              <div className="grid gap-2 md:grid-cols-[1fr_180px_120px]">
                <input
                  value={compPlayerId}
                  onChange={(event) => setCompPlayerId(event.target.value)}
                  placeholder="playerId（留空=全服）"
                  className="rounded-lg border border-white/20 bg-slate-900/60 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  value={compAmount}
                  onChange={(event) => setCompAmount(Number(event.target.value))}
                  className="rounded-lg border border-white/20 bg-slate-900/60 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={sendCompensation}
                  className="rounded-lg border border-emerald-300/40 bg-emerald-500/20 px-3 py-2 text-sm"
                >
                  发送
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-white/15 bg-white/5 p-4">
              <h2 className="mb-3 text-lg font-medium">封禁与赛季控制</h2>
              <div className="grid gap-2 md:grid-cols-[1fr_120px_120px_160px]">
                <input
                  value={banPlayerId}
                  onChange={(event) => setBanPlayerId(event.target.value)}
                  placeholder="playerId"
                  className="rounded-lg border border-white/20 bg-slate-900/60 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => banPlayer(true)}
                  className="rounded-lg border border-rose-300/40 bg-rose-500/20 px-3 py-2 text-sm"
                >
                  封禁
                </button>
                <button
                  type="button"
                  onClick={() => banPlayer(false)}
                  className="rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-2 text-sm"
                >
                  解封
                </button>
                <button
                  type="button"
                  onClick={resetSeason}
                  className="rounded-lg border border-amber-300/40 bg-amber-500/20 px-3 py-2 text-sm"
                >
                  重置赛季
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default AdminPage;
