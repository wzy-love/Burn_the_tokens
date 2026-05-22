import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { motion } from "framer-motion";
import AdminPage from "./AdminPage";
import html2canvas from "html2canvas";
import ShareReportPage from "./ShareReportPage";
import {
  AudioWaveform,
  Copy,
  Crown,
  DoorOpen,
  Flame,
  Gauge,
  Gift,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  Zap
} from "lucide-react";

type Outcome = "jackpot" | "win" | "neutral" | "rug";

type BurnHistoryEntry = {
  id: string;
  burnAmount: number;
  reward: number;
  delta: number;
  outcome: Outcome;
  multiplier: number;
  usedItems: string[];
  shieldTriggered: boolean;
  doubleTriggered: boolean;
  bossRound: boolean;
  bossDefeated: boolean;
  at: string;
};

type DailyQuest = {
  id: string;
  title: string;
  description: string;
  target: number;
  progress: number;
  reward: number;
  completed: boolean;
  claimed: boolean;
};

type LeaderboardEntry = {
  id: string;
  name: string;
  tokens: number;
  rounds: number;
  seasonPoints: number;
};

type Achievement = {
  code: string;
  title: string;
  unlockedAt: string;
};

type SocialFriend = {
  id: string;
  name: string;
};

type SocialChallenge = {
  id: string;
  challenger: { id: string; name: string };
  opponent: { id: string; name: string };
  status: string;
  wager: number;
  challengerScore: number | null;
  opponentScore: number | null;
  winner?: { id: string; name: string } | null;
};

type SocialRoom = {
  roomCode: string;
  status: string;
  score: number;
};

type SocialOverview = {
  friends: SocialFriend[];
  challenges: SocialChallenge[];
  rooms: SocialRoom[];
};

type RoundShareSnapshot = {
  burn: BurnHistoryEntry;
  highestTokens: number;
  seasonPoints: number;
  currentTokens: number;
  inventory: {
    shield: number;
    double: number;
    luckyCharm: number;
  };
};

type ShareCopyTone = "hype" | "flex";

type GameState = {
  playerId: string;
  playerName: string;
  tokensLeft: number;
  highestTokens: number;
  totalBurned: number;
  totalReward: number;
  streak: number;
  bestStreak: number;
  rounds: number;
  seasonPoints: number;
  loginStreak: number;
  season: {
    id: string;
    roundsToBoss: number;
  };
  economy?: {
    mode: string;
    meanTokens: number;
    stdDevTokens: number;
    bias: number;
    protectedExtreme: boolean;
  };
  inventory: {
    shield: number;
    double: number;
    luckyCharm: number;
  };
  dailyQuests: DailyQuest[];
  achievements: Achievement[];
  leaderboard: LeaderboardEntry[];
  burnHistory: BurnHistoryEntry[];
};

type AuthResponse = {
  playerId: string;
  loginReward: number;
  state: GameState;
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username?: string | null;
    name: string;
    email?: string | null;
  };
};

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "http://localhost:4000";
const BASE_URL = import.meta.env.BASE_URL || "/";
const NORMALIZED_BASE_URL = BASE_URL.endsWith("/") ? BASE_URL.slice(0, -1) : BASE_URL;
const PLAYER_ID_KEY = "burn-token-player-id";
const PLAYER_NAME_KEY = "burn-token-player-name";
const ACCESS_TOKEN_KEY = "burn-token-access-token";
const REFRESH_TOKEN_KEY = "burn-token-refresh-token";

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

const toAppUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const prefix = NORMALIZED_BASE_URL && NORMALIZED_BASE_URL !== "/" ? NORMALIZED_BASE_URL : "";
  return `${prefix}${normalizedPath}`;
};

const outcomeStyleMap: Record<Outcome, string> = {
  jackpot: "text-fuchsia-200 bg-fuchsia-500/20 border-fuchsia-300/50",
  win: "text-emerald-200 bg-emerald-500/20 border-emerald-300/40",
  neutral: "text-cyan-200 bg-cyan-500/20 border-cyan-300/40",
  rug: "text-rose-200 bg-rose-500/20 border-rose-300/40"
};

const outcomeNameMap: Record<Outcome, string> = {
  jackpot: "JACKPOT",
  win: "WIN",
  neutral: "SAFE",
  rug: "RUG"
};

const itemMeta = {
  shield: { label: "护盾券", description: "RUG 时保本", icon: Shield },
  double: { label: "双倍券", description: "收益 x2", icon: Zap },
  luckyCharm: { label: "幸运符", description: "提高赢面", icon: Sparkles }
} as const;

const playTone = (frequency: number, durationMs: number, type: OscillatorType) => {
  try {
    const context = new window.AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    setTimeout(() => {
      oscillator.stop();
      context.close();
    }, durationMs);
  } catch {
    // Browser may block auto-play audio.
  }
};

const vibrate = (pattern: number | number[]) => {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(pattern);
  }
};

function App() {
  const appPathname = getAppPathname();
  if (appPathname.startsWith("/share/")) {
    return <ShareReportPage />;
  }

  if (appPathname.startsWith("/admin")) {
    return <AdminPage />;
  }

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [burnAmount, setBurnAmount] = useState(50);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [lastResult, setLastResult] = useState<BurnHistoryEntry | null>(null);
  const [playerName, setPlayerName] = useState(localStorage.getItem(PLAYER_NAME_KEY) || "Player");
  const [loginReward, setLoginReward] = useState(0);
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authAccount, setAuthAccount] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [accessToken, setAccessToken] = useState(localStorage.getItem(ACCESS_TOKEN_KEY) || "");
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem(REFRESH_TOKEN_KEY) || "");
  const [socialOverview, setSocialOverview] = useState<SocialOverview | null>(null);
  const [friendIdInput, setFriendIdInput] = useState("");
  const [pkOpponentId, setPkOpponentId] = useState("");
  const [pkChallengeId, setPkChallengeId] = useState("");
  const [pkScore, setPkScore] = useState(0);
  const [pkWager, setPkWager] = useState(50);
  const [roomCodeInput, setRoomCodeInput] = useState("");
  const [roomScoreInput, setRoomScoreInput] = useState(0);
  const [shareUrl, setShareUrl] = useState("");
  const [roundShare, setRoundShare] = useState<RoundShareSnapshot | null>(null);
  const [shareCopyTone, setShareCopyTone] = useState<ShareCopyTone>("hype");
  const [socialMessage, setSocialMessage] = useState("");
  const [historyActionMessage, setHistoryActionMessage] = useState("");
  const sharePosterRef = useRef<HTMLDivElement | null>(null);

  const maxBurnAmount = useMemo(
    () => Math.max(10, gameState?.tokensLeft ?? 1000),
    [gameState?.tokensLeft]
  );

  useEffect(() => {
    if (accessToken) {
      axios.defaults.headers.common.Authorization = `Bearer ${accessToken}`;
    } else {
      delete axios.defaults.headers.common.Authorization;
    }
  }, [accessToken]);

  const persistTokens = (nextAccessToken: string, nextRefreshToken: string) => {
    setAccessToken(nextAccessToken);
    setRefreshToken(nextRefreshToken);
    localStorage.setItem(ACCESS_TOKEN_KEY, nextAccessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, nextRefreshToken);
  };

  const clearAuth = () => {
    setAccessToken("");
    setRefreshToken("");
    setGameState(null);
    setSocialOverview(null);
    setLastResult(null);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(PLAYER_ID_KEY);
  };

  const applyAuthPayload = (data: AuthResponse) => {
    localStorage.setItem(PLAYER_ID_KEY, data.playerId);
    localStorage.setItem(PLAYER_NAME_KEY, data.state.playerName);
    setPlayerName(data.state.playerName);
    persistTokens(data.accessToken, data.refreshToken);
    setLoginReward(data.loginReward);
    setGameState(data.state);
    setLastResult(data.state.burnHistory[0] ?? null);
  };

  const refreshAccessToken = async () => {
    if (!refreshToken) return false;
    try {
      const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
        `${API_BASE}/api/auth/refresh`,
        { refreshToken }
      );
      persistTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      clearAuth();
      return false;
    }
  };

  const fetchState = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;
    const { data } = await axios.get<GameState>(`${API_BASE}/api/game/state`, {
      params: { playerId }
    });
    setGameState(data);
    setLastResult(data.burnHistory[0] ?? null);
  };

  const fetchSocialOverview = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;
    const { data } = await axios.get<SocialOverview>(`${API_BASE}/api/social/overview`, {
      params: { playerId }
    });
    setSocialOverview(data);
  };

  useEffect(() => {
    const init = async () => {
      if (!accessToken) {
        setLoading(false);
        return;
      }
      try {
        const { data } = await axios.get<{ playerId: string; state: GameState; user: { name: string } }>(
          `${API_BASE}/api/auth/me`
        );
        localStorage.setItem(PLAYER_ID_KEY, data.playerId);
        localStorage.setItem(PLAYER_NAME_KEY, data.user.name);
        setPlayerName(data.user.name);
        setGameState(data.state);
        setLastResult(data.state.burnHistory[0] ?? null);
        await fetchSocialOverview();
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          const refreshed = await refreshAccessToken();
          if (refreshed) {
            return init();
          }
        }
        clearAuth();
        setError("登录状态失效，请重新登录。");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [accessToken]);

  useEffect(() => {
    if (burnAmount > maxBurnAmount) setBurnAmount(maxBurnAmount);
  }, [burnAmount, maxBurnAmount]);

  const toggleItem = (item: string) => {
    setSelectedItems((prev) =>
      prev.includes(item) ? prev.filter((token) => token !== item) : [...prev, item]
    );
  };

  const triggerFeedback = (entry: BurnHistoryEntry) => {
    if (entry.outcome === "jackpot") {
      playTone(760, 180, "triangle");
      playTone(980, 220, "sine");
      vibrate([80, 40, 100, 40, 120]);
      return;
    }
    if (entry.outcome === "win") {
      playTone(620, 140, "sine");
      vibrate([60, 30, 80]);
      return;
    }
    if (entry.outcome === "neutral") {
      playTone(420, 100, "triangle");
      vibrate(40);
      return;
    }
    playTone(180, 200, "square");
    vibrate([140, 60, 140]);
  };

  const onRegister = async () => {
    setAuthLoading(true);
    setError("");
    try {
      const { data } = await axios.post<AuthResponse>(`${API_BASE}/api/auth/register`, {
        username: authAccount.trim(),
        email: authEmail.trim(),
        password: authPassword
      });
      applyAuthPayload(data);
      await fetchSocialOverview();
      setAuthPassword("");
      setAuthEmail("");
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "注册失败")
        : "注册失败";
      setError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  const onLogin = async () => {
    setAuthLoading(true);
    setError("");
    try {
      const { data } = await axios.post<AuthResponse>(`${API_BASE}/api/auth/login`, {
        account: authAccount.trim(),
        password: authPassword
      });
      applyAuthPayload(data);
      await fetchSocialOverview();
      setAuthPassword("");
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "登录失败")
        : "登录失败";
      setError(message);
    } finally {
      setAuthLoading(false);
    }
  };

  const onLogout = () => {
    clearAuth();
    setError("");
    setLoginReward(0);
  };

  const onBurn = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;

    setSubmitting(true);
    setError("");
    try {
      const { data } = await axios.post<{ entry: BurnHistoryEntry; state: GameState }>(
        `${API_BASE}/api/game/burn`,
        {
          playerId,
          amount: burnAmount,
          useItems: selectedItems
        }
      );
      setGameState(data.state);
      setLastResult(data.entry);
      triggerFeedback(data.entry);
      setSelectedItems([]);
      setShareUrl("");
      setRoundShare(
        data.state.tokensLeft <= 0
          ? {
              burn: data.entry,
              highestTokens: data.state.highestTokens,
              seasonPoints: data.state.seasonPoints,
              currentTokens: data.state.tokensLeft,
              inventory: data.state.inventory
            }
          : null
      );
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Burn failed.")
        : "Burn failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onReset = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;
    setSubmitting(true);
    setError("");
    try {
      await axios.post(`${API_BASE}/api/game/reset`, { playerId });
      await fetchState();
      setSelectedItems([]);
      setLastResult(null);
      setRoundShare(null);
      setShareUrl("");
    } catch {
      setError("Reset failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onClaimQuest = async (questId: string) => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;
    setSubmitting(true);
    setError("");
    try {
      const { data } = await axios.post<{ state: GameState }>(`${API_BASE}/api/game/daily/claim`, {
        playerId,
        questId
      });
      setGameState(data.state);
      playTone(680, 140, "sine");
      vibrate([50, 30, 60]);
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Claim failed.")
        : "Claim failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onAddFriend = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !friendIdInput.trim()) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      await axios.post(`${API_BASE}/api/social/friends/add`, {
        playerId,
        friendId: friendIdInput.trim()
      });
      setFriendIdInput("");
      setSocialMessage("好友添加成功");
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Add friend failed.")
        : "Add friend failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCreatePk = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !pkOpponentId.trim()) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      const { data } = await axios.post<{ challenge: SocialChallenge }>(
        `${API_BASE}/api/social/pk/challenge`,
        {
          playerId,
          opponentId: pkOpponentId.trim(),
          wager: pkWager
        }
      );
      setPkChallengeId(data.challenge.id);
      setSocialMessage("PK 挑战已创建");
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Create challenge failed.")
        : "Create challenge failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitPkScore = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !pkChallengeId.trim()) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      await axios.post(`${API_BASE}/api/social/pk/submit`, {
        playerId,
        challengeId: pkChallengeId.trim(),
        score: pkScore
      });
      setSocialMessage("PK 分数已提交");
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Submit PK failed.")
        : "Submit PK failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCreateRoom = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      const { data } = await axios.post<{ roomCode: string }>(`${API_BASE}/api/social/rooms/create`, {
        playerId
      });
      setRoomCodeInput(data.roomCode);
      setSocialMessage(`房间已创建：${data.roomCode}`);
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Create room failed.")
        : "Create room failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onJoinRoom = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !roomCodeInput.trim()) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      await axios.post(`${API_BASE}/api/social/rooms/join`, {
        playerId,
        roomCode: roomCodeInput.trim()
      });
      setSocialMessage("已加入房间");
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Join room failed.")
        : "Join room failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmitRoomScore = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !roomCodeInput.trim()) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      await axios.post(`${API_BASE}/api/social/rooms/submit`, {
        playerId,
        roomCode: roomCodeInput.trim(),
        score: roomScoreInput
      });
      setSocialMessage("房间分数已提交");
      await fetchSocialOverview();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Submit room score failed.")
        : "Submit room score failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const buildBattleCopyText = (url?: string) => {
    if (!roundShare) return "";
    const moodMapByTone: Record<ShareCopyTone, Record<Outcome, string>> = {
      hype: {
        jackpot: "神之一手，直接起飞",
        win: "稳住节奏，持续上分",
        neutral: "稳扎稳打，继续拉扯",
        rug: "这把翻车了，下把打回来"
      },
      flex: {
        jackpot: "这波操作，榜一看了都沉默",
        win: "收益曲线持续向上，状态在线",
        neutral: "控盘节奏拿捏住了，继续滚雪球",
        rug: "战略性回撤，不影响最终封神"
      }
    };
    const moodMap = moodMapByTone[shareCopyTone];
    const usedItemText = roundShare.burn.usedItems.length
      ? roundShare.burn.usedItems.join(" / ")
      : "无";
    const bossText = roundShare.burn.bossRound
      ? roundShare.burn.bossDefeated
        ? "Boss 回合击败成功"
        : "Boss 回合遗憾失利"
      : "普通回合";

    return [
      "【Burn Token 战报】",
      `${moodMap[roundShare.burn.outcome]} ｜ ${bossText}`,
      `结果 ${outcomeNameMap[roundShare.burn.outcome]} x${roundShare.burn.multiplier}`,
      `燃烧 ${roundShare.burn.burnAmount} ｜ 盈亏 ${roundShare.burn.delta >= 0 ? "+" : ""}${roundShare.burn.delta}`,
      `当前Token ${roundShare.currentTokens} ｜ 最高Token ${roundShare.highestTokens}`,
      `赛季积分 ${roundShare.seasonPoints}`,
      `道具 ${usedItemText}`,
      shareCopyTone === "hype"
        ? "#BurnToken #链上小游戏 #战报"
        : "#BurnToken #赛季冲榜 #高能回合",
      url ? `分享链接 ${url}` : ""
    ]
      .filter(Boolean)
      .join("\n");
  };

  const onCreateShare = async () => {
    const playerId = localStorage.getItem(PLAYER_ID_KEY);
    if (!playerId || !roundShare) return;
    setSubmitting(true);
    setError("");
    setSocialMessage("");
    try {
      const { data } = await axios.post<{ sharePath: string; shareCode: string }>(`${API_BASE}/api/social/share`, {
        playerId,
        burnLogId: roundShare.burn.id,
        title: `Round ${roundShare.burn.outcome.toUpperCase()} Report`
      });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}${toAppUrl(`/share/${data.shareCode}`)}`;
      setShareUrl(url);
      await navigator.clipboard.writeText(buildBattleCopyText(url));
      setSocialMessage("链接 + 战报文案已复制");
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? (err.response?.data?.message ?? "Create share failed.")
        : "Create share failed.";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const onCopyBattleText = async () => {
    if (!roundShare) return;
    await navigator.clipboard.writeText(buildBattleCopyText(shareUrl));
    setSocialMessage("战报文案已复制");
  };

  const onDownloadPoster = async () => {
    if (!sharePosterRef.current) return;
    const canvas = await html2canvas(sharePosterRef.current, {
      useCORS: true,
      backgroundColor: "#060a18",
      scale: 2
    });
    const link = document.createElement("a");
    link.download = `burn-report-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setSocialMessage("海报截图已下载");
  };

  const onSaveHistoryReport = async () => {
    if (!gameState?.burnHistory.length) {
      setHistoryActionMessage("当前没有可保留的战报");
      return;
    }
    setHistoryActionMessage("正在生成 JPG...");
    try {
      const entries = gameState.burnHistory;
      const rowHeight = 86;
      const padding = 28;
      const headerHeight = 104;
      const contentHeight = entries.length * rowHeight;
      const canvasWidth = 1180;
      const canvasHeight = headerHeight + contentHeight + padding * 2;
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth * scale;
      canvas.height = canvasHeight * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setHistoryActionMessage("导出失败，请重试");
        return;
      }
      ctx.scale(scale, scale);

      const drawRoundRect = (
        x: number,
        y: number,
        w: number,
        h: number,
        radius: number,
        fillStyle: string
      ) => {
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
      };

      const grad = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
      grad.addColorStop(0, "#0a0f24");
      grad.addColorStop(1, "#111b33");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);

      drawRoundRect(12, 12, canvasWidth - 24, canvasHeight - 24, 20, "rgba(255,255,255,0.03)");
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "700 34px Inter, Segoe UI, Arial";
      ctx.fillText("Burn Token 战报历史", padding, 58);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 20px Inter, Segoe UI, Arial";
      ctx.fillText(
        `${playerName} · 共 ${entries.length} 条 · ${new Date().toLocaleString()}`,
        padding,
        90
      );

      const outcomeBg: Record<Outcome, string> = {
        jackpot: "rgba(168,85,247,0.3)",
        win: "rgba(16,185,129,0.25)",
        neutral: "rgba(6,182,212,0.25)",
        rug: "rgba(244,63,94,0.25)"
      };

      entries.forEach((entry, index) => {
        const y = headerHeight + index * rowHeight;
        drawRoundRect(padding, y, canvasWidth - padding * 2, rowHeight - 10, 14, "rgba(15,23,42,0.65)");
        drawRoundRect(padding + 18, y + 14, 92, 30, 15, outcomeBg[entry.outcome]);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "700 16px Inter, Segoe UI, Arial";
        ctx.fillText(outcomeNameMap[entry.outcome], padding + 33, y + 35);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "500 17px Inter, Segoe UI, Arial";
        ctx.fillText(new Date(entry.at).toLocaleString(), padding + 18, y + 63);

        ctx.fillStyle = entry.delta >= 0 ? "#6ee7b7" : "#fda4af";
        ctx.font = "700 34px Inter, Segoe UI, Arial";
        const deltaText = `${entry.delta >= 0 ? "+" : ""}${entry.delta}`;
        const textWidth = ctx.measureText(deltaText).width;
        ctx.fillText(deltaText, canvasWidth - padding - textWidth - 20, y + 49);
      });

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.95)
      );
      let finalBlob: Blob;
      if (blob) {
        finalBlob = blob;
      } else {
        finalBlob = await fetch(canvas.toDataURL("image/jpeg", 0.95)).then((response) =>
          response.blob()
        );
      }

      const link = document.createElement("a");
      const safeName = (playerName || "player").replace(/[^\w-]/g, "_");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const objectUrl = URL.createObjectURL(finalBlob);
      link.download = `battle-history-${safeName}-${stamp}.jpg`;
      link.href = objectUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
      setHistoryActionMessage("战报历史已保存为 JPG");
    } catch {
      setHistoryActionMessage("导出失败，请重试");
    }
  };

  if (!loading && !accessToken) {
    return (
      <main className="min-h-screen text-slate-100">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(900px_420px_at_10%_0%,rgba(244,63,94,0.28),transparent),radial-gradient(900px_420px_at_90%_0%,rgba(99,102,241,0.3),transparent),linear-gradient(180deg,#08090f_0%,#0d1324_55%,#121a2d_100%)]" />
        <div className="mx-auto w-full max-w-md px-6 py-16">
          <section className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
            <h1 className="text-2xl font-semibold">{authMode === "login" ? "账号登录" : "账号注册"}</h1>
            <p className="mt-2 text-sm text-slate-300/80">登录后可跨设备保存你的赛季进度与战绩。</p>
            <div className="mt-5 space-y-3">
              <input
                value={authAccount}
                onChange={(event) => setAuthAccount(event.target.value)}
                className="w-full rounded-xl border border-white/20 bg-slate-950/50 px-3 py-2 text-sm"
                placeholder={authMode === "login" ? "用户名或邮箱" : "用户名（至少3位）"}
              />
              {authMode === "register" && (
                <input
                  value={authEmail}
                  onChange={(event) => setAuthEmail(event.target.value)}
                  className="w-full rounded-xl border border-white/20 bg-slate-950/50 px-3 py-2 text-sm"
                  placeholder="邮箱（可选）"
                />
              )}
              <input
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="w-full rounded-xl border border-white/20 bg-slate-950/50 px-3 py-2 text-sm"
                placeholder="密码（至少6位）"
              />
              <button
                type="button"
                onClick={authMode === "login" ? onLogin : onRegister}
                disabled={authLoading || !authAccount.trim() || authPassword.length < 6}
                className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {authLoading ? "处理中..." : authMode === "login" ? "登录" : "注册并开始"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setAuthMode((prev) => (prev === "login" ? "register" : "login"))}
              className="mt-4 text-xs text-cyan-300"
            >
              {authMode === "login" ? "没有账号？去注册" : "已有账号？去登录"}
            </button>
            {error && <p className="mt-3 text-sm text-rose-300">{error}</p>}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen text-slate-100">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(900px_420px_at_10%_0%,rgba(244,63,94,0.28),transparent),radial-gradient(900px_420px_at_90%_0%,rgba(99,102,241,0.3),transparent),linear-gradient(180deg,#08090f_0%,#0d1324_55%,#121a2d_100%)]" />
      <div className="mx-auto w-full max-w-7xl px-6 py-10 md:py-14">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-500/15 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">
              <Flame className="h-3.5 w-3.5" />
              Burn Token Arena
            </p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">烧 Token 生存挑战</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-300/80 md:text-base">
              赛季 {gameState?.season.id || "-"} · 距离下一次 Boss 回合还有{" "}
              <span className="text-amber-200">{gameState?.season.roundsToBoss ?? "-"}</span> 局
            </p>
            {loginReward > 0 && (
              <p className="mt-2 text-sm text-emerald-300">
                今日登录奖励 +{loginReward} Token（连续登录 {gameState?.loginStreak ?? 1} 天）
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 self-start">
            <input
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value.slice(0, 18))}
              className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm outline-none"
              placeholder="昵称"
            />
            <button
              type="button"
              disabled
              className="cursor-not-allowed rounded-xl border border-indigo-300/20 bg-indigo-500/10 px-3 py-2 text-sm text-slate-300/60"
            >
              破产后自动上榜
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-xl border border-rose-300/35 bg-rose-500/15 px-3 py-2 text-sm"
            >
              退出登录
            </button>
            <button
              type="button"
              onClick={onReset}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm"
            >
              <RotateCcw className="h-4 w-4" />
              重开
            </button>
          </div>
        </header>

        {loading ? (
          <section className="h-40 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ) : error ? (
          <section className="rounded-2xl border border-rose-300/40 bg-rose-400/10 p-6 text-rose-100">
            {error}
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {[
                { key: "tokensLeft", label: "剩余 Token", value: gameState?.tokensLeft ?? 0, icon: Wallet },
                { key: "seasonPoints", label: "赛季积分", value: gameState?.seasonPoints ?? 0, icon: Crown },
                { key: "streak", label: "当前连击", value: gameState?.streak ?? 0, icon: Swords },
                { key: "bestStreak", label: "最佳连击", value: gameState?.bestStreak ?? 0, icon: Trophy }
              ].map((metric, index) => (
                <motion.article
                  key={metric.key}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.06 }}
                  className="rounded-2xl border border-white/15 bg-white/8 p-5 backdrop-blur-xl"
                >
                  <p className="inline-flex items-center gap-2 text-sm text-slate-300/80">
                    <metric.icon className="h-4 w-4 text-indigo-300" />
                    {metric.label}
                  </p>
                  <p className="mt-3 text-3xl font-semibold tracking-tight">{metric.value}</p>
                </motion.article>
              ))}
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-[1.35fr_1fr]">
              <article className="flex h-full flex-col gap-5 rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="mb-3 inline-flex items-center gap-2 text-sm text-slate-300/80">
                    <Zap className="h-4 w-4 text-amber-300" />
                    燃烧额度（10 的倍数）
                  </p>
                  <input
                    type="range"
                    min={10}
                    max={maxBurnAmount}
                    step={10}
                    value={Math.min(burnAmount, maxBurnAmount)}
                    onChange={(event) => setBurnAmount(Number(event.target.value))}
                    className="w-full accent-amber-400"
                  />
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-300/80">本轮燃烧</span>
                    <span className="rounded-lg border border-amber-200/40 bg-amber-500/15 px-2 py-1 font-medium text-amber-100">
                      {Math.min(burnAmount, maxBurnAmount)} TOKENS
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onBurn}
                    disabled={submitting || (gameState?.tokensLeft ?? 0) < 10}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-rose-500 px-4 py-2 font-medium text-white disabled:opacity-40"
                  >
                    <Flame className="h-4 w-4" />
                    立刻燃烧
                  </button>
                </div>

                <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <p className="mb-3 inline-flex items-center gap-2 text-sm text-slate-300/80">
                    <Gift className="h-4 w-4 text-indigo-300" />
                    道具系统
                  </p>
                  <div className="space-y-2">
                    {(Object.keys(itemMeta) as Array<keyof typeof itemMeta>).map((key) => {
                      const meta = itemMeta[key];
                      const count = gameState?.inventory[key] ?? 0;
                      const active = selectedItems.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleItem(key)}
                          disabled={submitting || count <= 0}
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            active ? "border-indigo-300/50 bg-indigo-500/20" : "border-white/10 bg-slate-950/35"
                          } disabled:opacity-40`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="inline-flex items-center gap-2">
                              <meta.icon className="h-4 w-4 text-indigo-300" />
                              {meta.label}
                            </span>
                            <span className="text-xs text-slate-300/75">x{count}</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-300/75">{meta.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {lastResult && (
                  <div className="rounded-xl border border-white/10 bg-slate-900/40 p-4">
                    <p className="mb-2 text-sm text-slate-300/80">最近结果</p>
                    <div className="mb-2 flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs ${outcomeStyleMap[lastResult.outcome]}`}>
                        {outcomeNameMap[lastResult.outcome]}
                      </span>
                      <span className="text-sm text-slate-300/85">x{lastResult.multiplier}</span>
                      {lastResult.bossRound && (
                        <span className="rounded-full border border-amber-300/40 bg-amber-500/20 px-2 py-0.5 text-xs text-amber-100">
                          BOSS {lastResult.bossDefeated ? "击破" : "失败"}
                        </span>
                      )}
                    </div>
                    <p className="text-lg font-semibold text-white">
                      {lastResult.delta >= 0 ? "+" : ""}
                      {lastResult.delta} Tokens
                    </p>
                  </div>
                )}

                <div className="flex min-h-[260px] flex-1 flex-col rounded-xl border border-white/10 bg-slate-900/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="inline-flex items-center gap-2 text-sm font-medium">
                      <Gauge className="h-4 w-4 text-cyan-300" />
                      战报历史
                    </h2>
                    <button
                      type="button"
                      onClick={onSaveHistoryReport}
                      className="rounded-lg border border-cyan-300/35 bg-cyan-500/15 px-2.5 py-1 text-xs text-cyan-100"
                    >
                      保留战报
                    </button>
                  </div>
                  {historyActionMessage && (
                    <p className="mb-2 text-xs text-cyan-200/90">{historyActionMessage}</p>
                  )}
                  <div className="history-scroll min-h-[380px] flex-1 space-y-2 overflow-y-scroll pr-1">
                    {gameState?.burnHistory.length ? (
                      gameState.burnHistory.map((entry) => (
                        <div key={entry.id} className="rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${outcomeStyleMap[entry.outcome]}`}>
                              {outcomeNameMap[entry.outcome]}
                            </span>
                            <span className={entry.delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
                              {entry.delta >= 0 ? "+" : ""}
                              {entry.delta}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-400">
                            {new Date(entry.at).toLocaleString()}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-300/75">还没有战报，先来一把。</p>
                    )}
                  </div>
                </div>
              </article>

              <div className="space-y-6">
                <article className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
                  <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-medium">
                    <Gift className="h-5 w-5 text-emerald-300" />
                    每日任务
                  </h2>
                  <div className="space-y-3">
                    {gameState?.dailyQuests.map((quest) => (
                      <div key={quest.id} className="rounded-xl border border-white/10 bg-slate-900/35 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-100">{quest.title}</p>
                            <p className="text-xs text-slate-300/75">{quest.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => onClaimQuest(quest.id)}
                            disabled={submitting || !quest.completed || quest.claimed}
                            className="rounded-lg border border-emerald-300/30 bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-100 disabled:opacity-40"
                          >
                            {quest.claimed ? "已领" : `领 ${quest.reward}`}
                          </button>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-700/50">
                          <div
                            style={{ width: `${(quest.progress / quest.target) * 100}%` }}
                            className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
                  <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-medium">
                    <Trophy className="h-5 w-5 text-amber-300" />
                    成就墙
                  </h2>
                  <div className="space-y-2">
                    {gameState?.achievements.length ? (
                      gameState.achievements.map((achievement) => (
                        <div key={achievement.code} className="rounded-lg border border-white/10 bg-slate-900/35 px-3 py-2 text-sm">
                          {achievement.title}
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-300/75">尚未解锁成就，先烧一把。</p>
                    )}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="inline-flex items-center gap-2 text-lg font-medium">
                      <Crown className="h-5 w-5 text-amber-300" />
                      排行榜
                    </h2>
                    <span className="inline-flex items-center gap-1 text-xs text-slate-300/75">
                      <AudioWaveform className="h-3.5 w-3.5" />
                      赛季内排名
                    </span>
                  </div>
                  <div className="space-y-2">
                    {gameState?.leaderboard.length ? (
                      gameState.leaderboard.map((entry, index) => (
                        <div key={entry.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/35 px-3 py-2 text-sm">
                          <span className="text-slate-100">#{index + 1} {entry.name}</span>
                          <span className="text-amber-200">{entry.tokens}</span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-300/75">暂无榜单记录。</p>
                    )}
                  </div>
                </article>

                <article className="rounded-2xl border border-white/15 bg-white/8 p-6 backdrop-blur-xl">
                  <h2 className="mb-4 inline-flex items-center gap-2 text-lg font-medium">
                    <Users className="h-5 w-5 text-indigo-300" />
                    社交玩法
                  </h2>
                  <div className="space-y-4 text-sm">
                    <div className="rounded-lg border border-white/10 bg-slate-900/35 p-3">
                      <p className="mb-2 inline-flex items-center gap-1 text-slate-200">
                        <UserPlus className="h-4 w-4" />
                        添加好友（输入玩家ID）
                      </p>
                      <div className="flex gap-2">
                        <input
                          value={friendIdInput}
                          onChange={(event) => setFriendIdInput(event.target.value)}
                          className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          placeholder="friend playerId"
                        />
                        <button
                          type="button"
                          onClick={onAddFriend}
                          disabled={submitting || !friendIdInput.trim()}
                          className="rounded-lg border border-indigo-300/35 bg-indigo-500/20 px-2.5 py-1 text-xs"
                        >
                          添加
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-slate-300/70">
                        好友数：{socialOverview?.friends.length ?? 0}
                      </p>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-slate-900/35 p-3">
                      <p className="mb-2 inline-flex items-center gap-1 text-slate-200">
                        <Swords className="h-4 w-4" />
                        好友 PK
                      </p>
                      <div className="mb-2 flex gap-2">
                        <input
                          value={pkOpponentId}
                          onChange={(event) => setPkOpponentId(event.target.value)}
                          className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          placeholder="opponent playerId"
                        />
                        <input
                          type="number"
                          value={pkWager}
                          onChange={(event) => setPkWager(Number(event.target.value))}
                          className="w-20 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          min={0}
                        />
                        <button
                          type="button"
                          onClick={onCreatePk}
                          disabled={submitting || !pkOpponentId.trim()}
                          className="rounded-lg border border-amber-300/35 bg-amber-500/20 px-2.5 py-1 text-xs"
                        >
                          发起
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={pkChallengeId}
                          onChange={(event) => setPkChallengeId(event.target.value)}
                          className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          placeholder="challenge id"
                        />
                        <input
                          type="number"
                          value={pkScore}
                          onChange={(event) => setPkScore(Number(event.target.value))}
                          className="w-20 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          min={0}
                        />
                        <button
                          type="button"
                          onClick={onSubmitPkScore}
                          disabled={submitting || !pkChallengeId.trim()}
                          className="rounded-lg border border-emerald-300/35 bg-emerald-500/20 px-2.5 py-1 text-xs"
                        >
                          提交
                        </button>
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-slate-900/35 p-3">
                      <p className="mb-2 inline-flex items-center gap-1 text-slate-200">
                        <DoorOpen className="h-4 w-4" />
                        房间赛
                      </p>
                      <div className="mb-2 flex gap-2">
                        <button
                          type="button"
                          onClick={onCreateRoom}
                          disabled={submitting}
                          className="rounded-lg border border-cyan-300/35 bg-cyan-500/20 px-2.5 py-1 text-xs"
                        >
                          创建房间
                        </button>
                        <input
                          value={roomCodeInput}
                          onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())}
                          className="flex-1 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          placeholder="ROOMCODE"
                        />
                        <button
                          type="button"
                          onClick={onJoinRoom}
                          disabled={submitting || !roomCodeInput.trim()}
                          className="rounded-lg border border-cyan-300/35 bg-cyan-500/20 px-2.5 py-1 text-xs"
                        >
                          加入
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="number"
                          value={roomScoreInput}
                          onChange={(event) => setRoomScoreInput(Number(event.target.value))}
                          className="w-24 rounded-lg border border-white/15 bg-slate-950/50 px-2 py-1.5 text-xs"
                          min={0}
                        />
                        <button
                          type="button"
                          onClick={onSubmitRoomScore}
                          disabled={submitting || !roomCodeInput.trim()}
                          className="rounded-lg border border-cyan-300/35 bg-cyan-500/20 px-2.5 py-1 text-xs"
                        >
                          提交分数
                        </button>
                      </div>
                    </div>

                    {socialMessage && <p className="text-xs text-emerald-300">{socialMessage}</p>}
                  </div>
                </article>

              </div>
            </section>
          </>
        )}

        {roundShare && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/65 px-4">
            <div className="w-full max-w-md space-y-3">
              <div
                ref={sharePosterRef}
                className="rounded-2xl border border-fuchsia-300/35 bg-[radial-gradient(700px_220px_at_0%_0%,rgba(232,121,249,0.25),transparent),linear-gradient(160deg,#0a0f24_0%,#111827_65%,#1f2937_100%)] p-5 shadow-2xl"
              >
                <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-amber-200/35 bg-amber-500/15 px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
                  <Flame className="h-3 w-3" />
                  Burn Token Poster
                </p>
                <h3 className="text-xl font-semibold">Round End Report</h3>
                <p className="mt-1 text-xs text-slate-300/75">
                  {new Date(roundShare.burn.at).toLocaleString()}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-white/15 bg-white/8 p-2">
                    <p className="text-xs text-slate-300/75">结果</p>
                    <p className="mt-1 font-semibold">{outcomeNameMap[roundShare.burn.outcome]}</p>
                  </div>
                  <div className="rounded-lg border border-white/15 bg-white/8 p-2">
                    <p className="text-xs text-slate-300/75">剩余 Token</p>
                    <p className="mt-1 font-semibold text-cyan-200">{roundShare.currentTokens}</p>
                  </div>
                  <div className="rounded-lg border border-white/15 bg-white/8 p-2">
                    <p className="text-xs text-slate-300/75">最高 Token</p>
                    <p className="mt-1 font-semibold">{roundShare.highestTokens}</p>
                  </div>
                  <div className="rounded-lg border border-white/15 bg-white/8 p-2">
                    <p className="text-xs text-slate-300/75">赛季积分</p>
                    <p className="mt-1 font-semibold">{roundShare.seasonPoints}</p>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-white/15 bg-white/8 p-2 text-xs text-slate-300/85">
                  道具：{roundShare.burn.usedItems.length ? roundShare.burn.usedItems.join(" / ") : "无"}
                  <span className="mx-2">|</span>
                  背包：盾{roundShare.inventory.shield} 双{roundShare.inventory.double} 幸运{roundShare.inventory.luckyCharm}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShareCopyTone("hype")}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    shareCopyTone === "hype"
                      ? "border-orange-300/50 bg-orange-500/25 text-orange-100"
                      : "border-white/25 bg-white/10"
                  }`}
                >
                  热血版
                </button>
                <button
                  type="button"
                  onClick={() => setShareCopyTone("flex")}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    shareCopyTone === "flex"
                      ? "border-violet-300/50 bg-violet-500/25 text-violet-100"
                      : "border-white/25 bg-white/10"
                  }`}
                >
                  装杯版
                </button>
                <button
                  type="button"
                  onClick={onCreateShare}
                  disabled={submitting}
                  className="inline-flex items-center gap-1 rounded-lg border border-fuchsia-300/35 bg-fuchsia-500/20 px-3 py-2 text-xs"
                >
                  <Copy className="h-3.5 w-3.5" />
                  生成链接并复制文案
                </button>
                <button
                  type="button"
                  onClick={onDownloadPoster}
                  className="rounded-lg border border-cyan-300/35 bg-cyan-500/20 px-3 py-2 text-xs"
                >
                  一键截图下载
                </button>
                <button
                  type="button"
                  onClick={onCopyBattleText}
                  className="rounded-lg border border-emerald-300/35 bg-emerald-500/20 px-3 py-2 text-xs"
                >
                  一键复制战报文案
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoundShare(null);
                    setShareUrl("");
                  }}
                  className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-xs"
                >
                  关闭
                </button>
              </div>
              {shareUrl && (
                <p className="break-all rounded-lg border border-white/15 bg-white/8 px-3 py-2 text-xs text-slate-200">
                  {shareUrl}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default App;
