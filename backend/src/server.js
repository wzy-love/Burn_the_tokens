import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  captureException,
  initObservability,
  log,
  requestMetricsMiddleware
} from "./observability.js";
import {
  ACHIEVEMENTS,
  BOSS_BONUS_REWARD,
  BOSS_FAIL_PENALTY,
  BOSS_ROUND_INTERVAL,
  DAILY_QUESTS,
  ECONOMY_BALANCE_MAX_BIAS,
  ECONOMY_BALANCE_TAIL_KEEP_PERCENT,
  NEW_PLAYER_BOOST_MAX,
  NEW_PLAYER_BOOST_ROUNDS,
  PROBABILITY,
  START_TOKENS
} from "./gameConfig.js";

dotenv.config();
initObservability();

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL || "file:./dev.db"
});
const prisma = new PrismaClient({ adapter });
const app = express();
const PORT = Number(process.env.PORT || 4000);
const ADMIN_KEY = process.env.ADMIN_KEY || "admin123";
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret";
const JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || "2h";
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || "14d";
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const runtimeConfig = {
  jackpotScale: 1,
  winScale: 1,
  newPlayerBoostScale: 1,
  loginRewardScale: 1
};

app.use(
  cors(
    CORS_ORIGINS.length
      ? {
          origin: (origin, callback) => {
            if (!origin || CORS_ORIGINS.includes(origin)) {
              callback(null, true);
              return;
            }
            callback(new Error("Not allowed by CORS"));
          }
        }
      : undefined
  )
);
app.use(express.json());
app.use(requestMetricsMiddleware);

process.on("unhandledRejection", (reason) => {
  captureException(reason, { type: "unhandledRejection" });
});

process.on("uncaughtException", (error) => {
  captureException(error, { type: "uncaughtException" });
});

const respondError = (res, message, error, extra = {}) => {
  captureException(error, { message, ...extra });
  res.status(500).json({
    message,
    detail: String(error),
    requestId: res.getHeader("x-request-id") || undefined
  });
};

const todayKey = () => new Date().toISOString().slice(0, 10);

const getSeasonId = () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const firstDay = new Date(Date.UTC(year, 0, 1));
  const diffDays = Math.floor((now - firstDay) / 86400000);
  const week = Math.ceil((diffDays + firstDay.getUTCDay() + 1) / 7);
  return `S${year}W${String(week).padStart(2, "0")}`;
};

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const sanitizeName = (name) => String(name || "").trim().slice(0, 18) || "Player";
const friendPair = (a, b) => (a < b ? [a, b] : [b, a]);
const adminAuthorized = (key) => key && key === ADMIN_KEY;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const playerModel = Prisma.dmmf.datamodel.models.find((model) => model.name === "Player");
const supportsHighestTokens = Boolean(
  playerModel?.fields.some((field) => field.name === "highestTokens")
);
const readHighestTokens = (player) =>
  supportsHighestTokens ? (player.highestTokens ?? player.tokensLeft) : player.tokensLeft;

const issueTokens = (player) => {
  const accessToken = jwt.sign(
    { sub: player.id, name: player.name },
    JWT_ACCESS_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRES_IN }
  );
  const refreshToken = jwt.sign(
    { sub: player.id },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRES_IN }
  );
  return { accessToken, refreshToken };
};

const readBearerToken = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return "";
  return header.slice(7).trim();
};

const parseAccessToken = (req) => {
  const token = readBearerToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_ACCESS_SECRET);
  } catch {
    return null;
  }
};

const requireAuth = (req, res, next) => {
  const payload = parseAccessToken(req);
  if (!payload?.sub) {
    res.status(401).json({ message: "Unauthorized." });
    return;
  }
  req.authPlayerId = String(payload.sub);
  next();
};

const runLoginRewardFlow = async (player) => {
  const today = todayKey();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let nextStreak = player.loginStreak;
  let loginReward = 0;
  if (player.lastLoginDate !== today) {
    nextStreak = player.lastLoginDate === yesterday ? player.loginStreak + 1 : 1;
    loginReward = (50 + Math.min((nextStreak - 1) * 20, 120)) * runtimeConfig.loginRewardScale;
    loginReward = Math.round(loginReward);
  }

  const updated = await prisma.player.update({
    where: { id: player.id },
    data: {
      lastLoginDate: today,
      loginStreak: nextStreak,
      tokensLeft: { increment: loginReward },
      ...(supportsHighestTokens &&
      player.tokensLeft + loginReward > readHighestTokens(player)
        ? { highestTokens: player.tokensLeft + loginReward }
        : {}),
      ...(nextStreak > 0 && nextStreak % 3 === 0 ? { inventoryShield: { increment: 1 } } : {})
    }
  });
  return { updated, loginReward };
};

const computeEconomyBias = async (playerId, playerTokens) => {
  const rows = await prisma.player.findMany({
    select: { id: true, tokensLeft: true },
    orderBy: { tokensLeft: "asc" }
  });

  if (rows.length < 3) {
    return {
      bias: 0,
      isProtectedExtreme: false,
      mean: playerTokens,
      stdDev: 1
    };
  }

  const sum = rows.reduce((acc, row) => acc + row.tokensLeft, 0);
  const mean = sum / rows.length;
  const variance =
    rows.reduce((acc, row) => acc + (row.tokensLeft - mean) ** 2, 0) / rows.length;
  const stdDev = Math.max(1, Math.sqrt(variance));

  const rank = rows.findIndex((row) => row.id === playerId);
  const percentile = rank <= 0 ? 0 : rank / (rows.length - 1);
  const isProtectedExtreme =
    percentile <= ECONOMY_BALANCE_TAIL_KEEP_PERCENT ||
    percentile >= 1 - ECONOMY_BALANCE_TAIL_KEEP_PERCENT;

  if (isProtectedExtreme) {
    return {
      bias: 0,
      isProtectedExtreme: true,
      mean,
      stdDev
    };
  }

  // Gaussian-shaped pressure around the center; tails are naturally weaker.
  const z = (playerTokens - mean) / stdDev;
  const gaussianWeight = Math.exp(-0.5 * (z / 1.35) ** 2);
  const directional = -Math.tanh(z);
  const bias = clamp(
    directional * gaussianWeight * ECONOMY_BALANCE_MAX_BIAS,
    -ECONOMY_BALANCE_MAX_BIAS,
    ECONOMY_BALANCE_MAX_BIAS
  );

  return {
    bias,
    isProtectedExtreme: false,
    mean,
    stdDev
  };
};

const weightedResult = (useLuckyCharm, economyBias, newPlayerBoost) => {
  const caps = useLuckyCharm ? PROBABILITY.luckyCharm : PROBABILITY.base;
  const roll = Math.random();

  let jackpot = caps.jackpot * runtimeConfig.jackpotScale;
  let win = (caps.win - caps.jackpot) * runtimeConfig.winScale;
  let neutral = caps.neutral - caps.win;
  let rug = 1 - caps.neutral;

  if (economyBias > 0) {
    const moved = rug * economyBias;
    jackpot += moved * 0.35;
    win += moved * 0.65;
    rug -= moved;
  } else if (economyBias < 0) {
    const moved = (jackpot + win) * Math.abs(economyBias);
    jackpot -= moved * 0.35;
    win -= moved * 0.65;
    rug += moved;
  }

  if (newPlayerBoost > 0) {
    const movedFromRug = rug * Math.min(newPlayerBoost, 0.35);
    const movedFromNeutral = neutral * Math.min(newPlayerBoost * 0.55, 0.2);
    const totalMoved = movedFromRug + movedFromNeutral;
    rug -= movedFromRug;
    neutral -= movedFromNeutral;
    jackpot += totalMoved * 0.28;
    win += totalMoved * 0.72;
  }

  jackpot = Math.max(0.01, jackpot);
  win = Math.max(0.04, win);
  neutral = Math.max(0.2, neutral);
  rug = Math.max(0.05, rug);

  const total = jackpot + win + neutral + rug;
  jackpot /= total;
  win /= total;
  neutral /= total;
  rug /= total;

  const capJackpot = jackpot;
  const capWin = capJackpot + win;
  const capNeutral = capWin + neutral;

  if (roll < capJackpot) return { outcome: "jackpot", multiplier: randomInt(5, 8) };
  if (roll < capWin) return { outcome: "win", multiplier: randomInt(2, 4) };
  if (roll < capNeutral) return { outcome: "neutral", multiplier: 1 };
  return { outcome: "rug", multiplier: 0 };
};

const ensureDailyReset = async (playerId) => {
  const today = todayKey();
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player) return null;
  if (player.dailyDayKey === today) return player;

  return prisma.player.update({
    where: { id: playerId },
    data: {
      dailyDayKey: today,
      dailyRounds: 0,
      dailyWins: 0,
      dailyJackpots: 0
    }
  });
};

const getLeaderboard = async () =>
  prisma.leaderboardEntry.findMany({
    where: { seasonId: getSeasonId() },
    orderBy: [{ tokens: "desc" }, { seasonPoints: "desc" }, { rounds: "asc" }],
    take: 10
  });

const upsertEliminatedLeaderboardEntry = async ({
  playerId,
  name,
  highestTokens,
  rounds,
  seasonPoints
}) => {
  const seasonId = getSeasonId();
  const existing = await prisma.leaderboardEntry.findFirst({
    where: { playerId, seasonId },
    orderBy: { createdAt: "desc" }
  });

  if (!existing) {
    await prisma.leaderboardEntry.create({
      data: {
        id: nanoid(16),
        playerId,
        name: sanitizeName(name),
        tokens: highestTokens,
        rounds,
        seasonId,
        seasonPoints
      }
    });
    return;
  }

  await prisma.leaderboardEntry.update({
    where: { id: existing.id },
    data: {
      name: sanitizeName(name),
      tokens: Math.max(existing.tokens, highestTokens),
      rounds: Math.max(existing.rounds, rounds),
      seasonPoints: Math.max(existing.seasonPoints, seasonPoints)
    }
  });
};

const buildState = async (playerId) => {
  const player = await ensureDailyReset(playerId);
  if (!player) return null;
  const economy = await computeEconomyBias(playerId, player.tokensLeft);

  const [burns, claims, unlocks, leaderboard] = await Promise.all([
    prisma.burnLog.findMany({
      where: { playerId },
      orderBy: { createdAt: "desc" }
    }),
    prisma.questClaim.findMany({
      where: { playerId, dayKey: todayKey() }
    }),
    prisma.achievementUnlock.findMany({
      where: { playerId },
      orderBy: { createdAt: "asc" }
    }),
    getLeaderboard()
  ]);

  const claimedSet = new Set(claims.map((item) => item.questId));
  const remainingNewPlayerRounds = Math.max(0, NEW_PLAYER_BOOST_ROUNDS - player.rounds);
  const newPlayerBoost =
    remainingNewPlayerRounds > 0
      ? (remainingNewPlayerRounds / NEW_PLAYER_BOOST_ROUNDS) *
        NEW_PLAYER_BOOST_MAX *
        runtimeConfig.newPlayerBoostScale
      : 0;
  const dailyQuests = DAILY_QUESTS.map((quest) => {
    const progress = Math.min(player[quest.metric], quest.target);
    return {
      id: quest.id,
      title: quest.title,
      description: quest.description,
      target: quest.target,
      progress,
      reward: quest.reward,
      completed: progress >= quest.target,
      claimed: claimedSet.has(quest.id)
    };
  });

  return {
    playerId: player.id,
    playerName: player.name,
    tokensLeft: player.tokensLeft,
    highestTokens: readHighestTokens(player),
    totalBurned: player.totalBurned,
    totalReward: player.totalReward,
    streak: player.streak,
    bestStreak: player.bestStreak,
    rounds: player.rounds,
    seasonPoints: player.seasonPoints,
    inventory: {
      shield: player.inventoryShield,
      double: player.inventoryDouble,
      luckyCharm: player.inventoryLucky
    },
    season: {
      id: getSeasonId(),
      roundsToBoss: BOSS_ROUND_INTERVAL - (player.rounds % BOSS_ROUND_INTERVAL || 0)
    },
    economy: {
      mode: "normal-distribution-balance",
      meanTokens: Math.round(economy.mean),
      stdDevTokens: Math.round(economy.stdDev),
      bias: Number(economy.bias.toFixed(4)),
      protectedExtreme: economy.isProtectedExtreme,
      newPlayerBoost: Number(newPlayerBoost.toFixed(4)),
      newbieRoundsLeft: remainingNewPlayerRounds
    },
    loginStreak: player.loginStreak,
    dailyQuests,
    achievements: unlocks.map((item) => ({
      code: item.code,
      title: item.title,
      unlockedAt: item.createdAt
    })),
    burnHistory: burns.map((item) => ({
      id: item.id,
      burnAmount: item.burnAmount,
      reward: item.reward,
      delta: item.delta,
      outcome: item.outcome,
      multiplier: item.multiplier,
      usedItems: JSON.parse(item.usedItems || "[]"),
      shieldTriggered: item.shieldTriggered,
      doubleTriggered: item.doubleTriggered,
      bossRound: item.bossRound,
      bossDefeated: item.bossDefeated,
      at: item.createdAt
    })),
    leaderboard
  };
};

const unlockAchievements = async (player) => {
  const existing = await prisma.achievementUnlock.findMany({
    where: { playerId: player.id },
    select: { code: true }
  });
  const existingCodes = new Set(existing.map((item) => item.code));
  const unlockable = ACHIEVEMENTS.filter(
    (achievement) => !existingCodes.has(achievement.code) && achievement.condition(player)
  );

  if (!unlockable.length) return [];

  await prisma.achievementUnlock.createMany({
    data: unlockable.map((achievement) => ({
      id: nanoid(16),
      playerId: player.id,
      code: achievement.code,
      title: achievement.title
    }))
  });
  return unlockable.map((item) => item.code);
};

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "burn-token-api", season: getSeasonId() });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim().toLowerCase();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const displayName = sanitizeName(username || "Player");

    if (!username || username.length < 3) {
      res.status(400).json({ message: "username must be at least 3 chars." });
      return;
    }
    if (!password || password.length < 6) {
      res.status(400).json({ message: "password must be at least 6 chars." });
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ message: "invalid email format." });
      return;
    }

    const duplicate = await prisma.player.findFirst({
      where: {
        OR: [{ username }, ...(email ? [{ email }] : [])]
      },
      select: { id: true }
    });
    if (duplicate) {
      res.status(409).json({ message: "username or email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const playerId = nanoid(14);
    const loginReward = Math.round(80 * runtimeConfig.loginRewardScale);
    const created = await prisma.player.create({
      data: {
        id: playerId,
        name: displayName,
        username,
        email: email || null,
        passwordHash,
        dailyDayKey: todayKey(),
        lastLoginDate: todayKey(),
        loginStreak: 1,
        tokensLeft: START_TOKENS + loginReward,
        ...(supportsHighestTokens ? { highestTokens: START_TOKENS + loginReward } : {})
      }
    });
    const state = await buildState(created.id);
    const tokens = issueTokens(created);
    res.status(201).json({
      playerId: created.id,
      loginReward,
      state,
      ...tokens,
      user: {
        id: created.id,
        username: created.username,
        name: created.name,
        email: created.email
      }
    });
  } catch (error) {
    respondError(res, "Register failed.", error);
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const account = String(req.body?.account || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!account || !password) {
      res.status(400).json({ message: "account and password are required." });
      return;
    }

    const player = await prisma.player.findFirst({
      where: {
        OR: [{ username: account }, { email: account }]
      }
    });
    if (!player || !player.passwordHash) {
      res.status(401).json({ message: "Invalid credentials." });
      return;
    }
    if (player.isBanned) {
      res.status(403).json({ message: "This player is banned." });
      return;
    }
    const valid = await bcrypt.compare(password, player.passwordHash);
    if (!valid) {
      res.status(401).json({ message: "Invalid credentials." });
      return;
    }

    const { updated, loginReward } = await runLoginRewardFlow(player);
    const state = await buildState(updated.id);
    const tokens = issueTokens(updated);
    res.json({
      playerId: updated.id,
      loginReward,
      state,
      ...tokens,
      user: {
        id: updated.id,
        username: updated.username,
        name: updated.name,
        email: updated.email
      }
    });
  } catch (error) {
    respondError(res, "Login failed.", error);
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "");
    if (!refreshToken) {
      res.status(400).json({ message: "refreshToken is required." });
      return;
    }
    let payload = null;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch {
      res.status(401).json({ message: "Invalid refresh token." });
      return;
    }

    const player = await prisma.player.findUnique({ where: { id: String(payload.sub) } });
    if (!player || player.isBanned) {
      res.status(401).json({ message: "Player is not available." });
      return;
    }
    const tokens = issueTokens(player);
    res.json(tokens);
  } catch (error) {
    respondError(res, "Refresh token failed.", error);
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const player = await prisma.player.findUnique({ where: { id: req.authPlayerId } });
    if (!player) {
      res.status(404).json({ message: "Player not found." });
      return;
    }
    if (player.isBanned) {
      res.status(403).json({ message: "Player is banned." });
      return;
    }
    const state = await buildState(player.id);
    res.json({
      playerId: player.id,
      state,
      user: {
        id: player.id,
        username: player.username,
        name: player.name,
        email: player.email
      }
    });
  } catch (error) {
    respondError(res, "Get current user failed.", error);
  }
});

app.post("/api/auth/session", async (req, res) => {
  try {
    const requestedId = String(req.body?.playerId || "");
    const playerId = requestedId || nanoid(14);
    const name = sanitizeName(req.body?.name);
    const today = todayKey();

    const existing = await prisma.player.findUnique({ where: { id: playerId } });
    let loginReward = 0;

    if (!existing) {
      await prisma.player.create({
        data: {
          id: playerId,
          name,
          dailyDayKey: today,
          lastLoginDate: today
        }
      });
      loginReward = Math.round(80 * runtimeConfig.loginRewardScale);
      await prisma.player.update({
        where: { id: playerId },
        data: {
          tokensLeft: { increment: loginReward },
          ...(supportsHighestTokens ? { highestTokens: { increment: loginReward } } : {}),
          loginStreak: 1
        }
      });
    } else {
      if (existing.isBanned) {
        res.status(403).json({ message: "This player is banned." });
        return;
      }
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      let nextStreak = existing.loginStreak;
      if (existing.lastLoginDate !== today) {
        nextStreak = existing.lastLoginDate === yesterday ? existing.loginStreak + 1 : 1;
        loginReward =
          (50 + Math.min((nextStreak - 1) * 20, 120)) * runtimeConfig.loginRewardScale;
        loginReward = Math.round(loginReward);
      }

      await prisma.player.update({
        where: { id: playerId },
        data: {
          name,
          lastLoginDate: today,
          loginStreak: nextStreak,
          tokensLeft: { increment: loginReward },
          ...(supportsHighestTokens &&
          existing.tokensLeft + loginReward > readHighestTokens(existing)
            ? { highestTokens: existing.tokensLeft + loginReward }
            : {}),
          ...(nextStreak > 0 && nextStreak % 3 === 0 ? { inventoryShield: { increment: 1 } } : {})
        }
      });
    }

    const state = await buildState(playerId);
    res.json({ playerId, loginReward, state });
  } catch (error) {
    respondError(res, "Failed to create session.", error);
  }
});

app.get("/api/game/state", async (req, res) => {
  try {
    const playerId = String(req.query.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (player?.isBanned) {
      res.status(403).json({ message: "Player is banned." });
      return;
    }
    const state = await buildState(playerId);
    if (!state) {
      res.status(404).json({ message: "Player not found." });
      return;
    }
    res.json(state);
  } catch (error) {
    respondError(res, "Failed to fetch game state.", error);
  }
});

app.post("/api/game/burn", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const burnAmount = Number(req.body?.amount);
    const requestedItems = Array.isArray(req.body?.useItems) ? req.body.useItems : [];

    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }
    if (!Number.isFinite(burnAmount) || burnAmount <= 0 || burnAmount % 10 !== 0) {
      res.status(400).json({ message: "Burn amount must be a positive multiple of 10." });
      return;
    }

    const player = await ensureDailyReset(playerId);
    if (!player) {
      res.status(404).json({ message: "Player not found." });
      return;
    }
    if (player.isBanned) {
      res.status(403).json({ message: "Player is banned." });
      return;
    }
    if (player.isBanned) {
      res.status(403).json({ message: "Player is banned." });
      return;
    }
    if (burnAmount > player.tokensLeft) {
      res.status(400).json({ message: "Not enough tokens." });
      return;
    }

    const useItems = [...new Set(requestedItems.filter(Boolean))];
    const useShield = useItems.includes("shield");
    const useDouble = useItems.includes("double");
    const useLuckyCharm = useItems.includes("luckyCharm");

    if (useShield && player.inventoryShield <= 0) {
      res.status(400).json({ message: "Shield is not available." });
      return;
    }
    if (useDouble && player.inventoryDouble <= 0) {
      res.status(400).json({ message: "Double is not available." });
      return;
    }
    if (useLuckyCharm && player.inventoryLucky <= 0) {
      res.status(400).json({ message: "Lucky Charm is not available." });
      return;
    }

    const economy = await computeEconomyBias(playerId, player.tokensLeft);
    const remainingNewPlayerRounds = Math.max(0, NEW_PLAYER_BOOST_ROUNDS - player.rounds);
    const newPlayerBoost =
      remainingNewPlayerRounds > 0
        ? (remainingNewPlayerRounds / NEW_PLAYER_BOOST_ROUNDS) *
          NEW_PLAYER_BOOST_MAX *
          runtimeConfig.newPlayerBoostScale
        : 0;
    let result = weightedResult(useLuckyCharm, economy.bias, newPlayerBoost);
    let shieldTriggered = false;
    if (useShield && result.outcome === "rug") {
      result = { outcome: "neutral", multiplier: 1 };
      shieldTriggered = true;
    }

    let reward = burnAmount * result.multiplier;
    let doubleTriggered = false;
    if (useDouble) {
      reward *= 2;
      doubleTriggered = true;
    }

    const bossRound = (player.rounds + 1) % BOSS_ROUND_INTERVAL === 0;
    let bossDefeated = false;
    let bossAdjust = 0;
    if (bossRound) {
      if ((result.outcome === "win" || result.outcome === "jackpot") && burnAmount >= 80) {
        bossDefeated = true;
        bossAdjust = BOSS_BONUS_REWARD;
      } else {
        bossAdjust = -BOSS_FAIL_PENALTY;
      }
    }

    const delta = reward - burnAmount + bossAdjust;
    const seasonPointsGain =
      Math.max(0, Math.floor(delta / 20)) +
      (bossDefeated ? 20 : 0) +
      (result.outcome === "jackpot" ? 25 : 0);
    const nextTokens = player.tokensLeft + delta;

    const updatedPlayer = await prisma.$transaction(async (tx) => {
      const nextStreak =
        result.outcome === "win" || result.outcome === "jackpot" ? player.streak + 1 : 0;
      const data = {
        tokensLeft: { increment: delta },
        totalBurned: { increment: burnAmount },
        totalReward: { increment: reward },
        rounds: { increment: 1 },
        streak: nextStreak,
        bestStreak: Math.max(player.bestStreak, nextStreak),
        ...(supportsHighestTokens
          ? { highestTokens: Math.max(readHighestTokens(player), nextTokens) }
          : {}),
        seasonPoints: { increment: seasonPointsGain },
        dailyRounds: { increment: 1 },
        dailyWins:
          result.outcome === "win" || result.outcome === "jackpot"
            ? { increment: 1 }
            : undefined,
        dailyJackpots: result.outcome === "jackpot" ? { increment: 1 } : undefined,
        inventoryShield: useShield ? { decrement: 1 } : undefined,
        inventoryDouble: useDouble ? { decrement: 1 } : undefined,
        inventoryLucky: useLuckyCharm ? { decrement: 1 } : undefined
      };

      await tx.burnLog.create({
        data: {
          id: nanoid(16),
          playerId,
          burnAmount,
          reward,
          delta,
          outcome: result.outcome,
          multiplier: result.multiplier,
          usedItems: JSON.stringify(useItems),
          shieldTriggered,
          doubleTriggered,
          bossRound,
          bossDefeated
        }
      });

      return tx.player.update({ where: { id: playerId }, data });
    });

    if (nextTokens <= 0) {
      await upsertEliminatedLeaderboardEntry({
        playerId: updatedPlayer.id,
        name: updatedPlayer.name,
        highestTokens: readHighestTokens(updatedPlayer),
        rounds: updatedPlayer.rounds,
        seasonPoints: updatedPlayer.seasonPoints
      });
    }

    const unlocked = await unlockAchievements(updatedPlayer);
    const state = await buildState(playerId);

    res.status(201).json({
      message: "Burn complete.",
      unlockedAchievements: unlocked,
      entry: state?.burnHistory[0] ?? null,
      state
    });
  } catch (error) {
    respondError(res, "Burn failed.", error);
  }
});

app.post("/api/game/reset", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    await prisma.$transaction([
      prisma.player.update({
        where: { id: playerId },
        data: {
          tokensLeft: START_TOKENS,
          ...(supportsHighestTokens ? { highestTokens: START_TOKENS } : {}),
          totalBurned: 0,
          totalReward: 0,
          streak: 0,
          bestStreak: 0,
          rounds: 0,
          seasonPoints: 0,
          inventoryShield: 2,
          inventoryDouble: 1,
          inventoryLucky: 1,
          dailyRounds: 0,
          dailyWins: 0,
          dailyJackpots: 0
        }
      }),
      prisma.burnLog.deleteMany({ where: { playerId } }),
      prisma.questClaim.deleteMany({ where: { playerId, dayKey: todayKey() } })
    ]);

    const state = await buildState(playerId);
    res.json({ message: "Game reset.", state });
  } catch (error) {
    respondError(res, "Reset failed.", error);
  }
});

app.post("/api/game/daily/claim", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const questId = String(req.body?.questId || "");
    const quest = DAILY_QUESTS.find((item) => item.id === questId);

    if (!playerId || !quest) {
      res.status(400).json({ message: "playerId and valid questId are required." });
      return;
    }

    const player = await ensureDailyReset(playerId);
    if (!player) {
      res.status(404).json({ message: "Player not found." });
      return;
    }
    if (player[quest.metric] < quest.target) {
      res.status(400).json({ message: "Quest not completed yet." });
      return;
    }

    await prisma.$transaction([
      prisma.questClaim.create({
        data: {
          id: nanoid(16),
          playerId,
          questId,
          dayKey: todayKey()
        }
      }),
      prisma.player.update({
        where: { id: playerId },
        data: { tokensLeft: { increment: quest.reward } }
      })
    ]);

    const state = await buildState(playerId);
    res.json({ message: "Daily quest claimed.", reward: quest.reward, state });
  } catch (error) {
    respondError(res, "Claim failed.", error);
  }
});

app.get("/api/game/leaderboard", async (_req, res) => {
  try {
    const leaderboard = await getLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    respondError(res, "Failed to load leaderboard.", error);
  }
});

app.post("/api/game/leaderboard/submit", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      res.status(404).json({ message: "Player not found." });
      return;
    }
    if (player.tokensLeft > 0) {
      res
        .status(400)
        .json({ message: "Leaderboard is auto-submitted only when tokens are <= 0." });
      return;
    }

    await upsertEliminatedLeaderboardEntry({
      playerId,
      name: req.body?.name || player.name,
      highestTokens: readHighestTokens(player),
      rounds: player.rounds,
      seasonPoints: player.seasonPoints
    });

    const leaderboard = await getLeaderboard();
    res.status(201).json({ message: "Elimination score submitted.", leaderboard });
  } catch (error) {
    respondError(res, "Submit score failed.", error);
  }
});

app.get("/api/social/overview", async (req, res) => {
  try {
    const playerId = String(req.query.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    const [friends, challenges, rooms] = await Promise.all([
      prisma.friendship.findMany({
        where: { OR: [{ leftId: playerId }, { rightId: playerId }] },
        include: {
          left: { select: { id: true, name: true } },
          right: { select: { id: true, name: true } }
        },
        take: 20
      }),
      prisma.pkChallenge.findMany({
        where: { OR: [{ challengerId: playerId }, { opponentId: playerId }] },
        include: {
          challenger: { select: { id: true, name: true } },
          opponent: { select: { id: true, name: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      prisma.battleRoomEntry.findMany({
        where: { playerId },
        include: { room: true },
        orderBy: { updatedAt: "desc" },
        take: 20
      })
    ]);

    res.json({
      friends: friends.map((item) => {
        const friend = item.leftId === playerId ? item.right : item.left;
        return { id: friend.id, name: friend.name };
      }),
      challenges,
      rooms: rooms.map((entry) => ({
        roomCode: entry.roomCode,
        status: entry.room.status,
        score: entry.score
      }))
    });
  } catch (error) {
    respondError(res, "Failed to load social overview.", error);
  }
});

app.post("/api/social/friends/add", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const friendId = String(req.body?.friendId || "");

    if (!playerId || !friendId) {
      res.status(400).json({ message: "playerId and friendId are required." });
      return;
    }
    if (playerId === friendId) {
      res.status(400).json({ message: "Cannot add yourself as friend." });
      return;
    }

    const [me, other] = await Promise.all([
      prisma.player.findUnique({ where: { id: playerId } }),
      prisma.player.findUnique({ where: { id: friendId } })
    ]);
    if (!me || !other) {
      res.status(404).json({ message: "Player not found." });
      return;
    }

    const [leftId, rightId] = friendPair(playerId, friendId);
    await prisma.friendship.upsert({
      where: { leftId_rightId: { leftId, rightId } },
      update: {},
      create: {
        id: nanoid(16),
        leftId,
        rightId
      }
    });

    res.status(201).json({ message: "Friend added.", friend: { id: other.id, name: other.name } });
  } catch (error) {
    respondError(res, "Add friend failed.", error);
  }
});

app.get("/api/social/friends", async (req, res) => {
  try {
    const playerId = String(req.query.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    const links = await prisma.friendship.findMany({
      where: { OR: [{ leftId: playerId }, { rightId: playerId }] },
      include: {
        left: { select: { id: true, name: true } },
        right: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(
      links.map((item) => {
        const friend = item.leftId === playerId ? item.right : item.left;
        return { id: friend.id, name: friend.name, friendSince: item.createdAt };
      })
    );
  } catch (error) {
    respondError(res, "Fetch friends failed.", error);
  }
});

app.post("/api/social/pk/challenge", async (req, res) => {
  try {
    const challengerId = String(req.body?.playerId || "");
    const opponentId = String(req.body?.opponentId || "");
    const wager = Math.max(0, Number(req.body?.wager || 0));

    if (!challengerId || !opponentId) {
      res.status(400).json({ message: "playerId and opponentId are required." });
      return;
    }
    if (challengerId === opponentId) {
      res.status(400).json({ message: "Cannot challenge yourself." });
      return;
    }

    const challenge = await prisma.pkChallenge.create({
      data: {
        id: nanoid(16),
        challengerId,
        opponentId,
        wager,
        status: "open"
      },
      include: {
        challenger: { select: { id: true, name: true } },
        opponent: { select: { id: true, name: true } }
      }
    });

    res.status(201).json({ message: "Challenge created.", challenge });
  } catch (error) {
    respondError(res, "Create challenge failed.", error);
  }
});

app.post("/api/social/pk/submit", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const challengeId = String(req.body?.challengeId || "");
    const score = Number(req.body?.score);

    if (!playerId || !challengeId || !Number.isFinite(score) || score < 0) {
      res.status(400).json({ message: "playerId, challengeId and valid score are required." });
      return;
    }

    const challenge = await prisma.pkChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) {
      res.status(404).json({ message: "Challenge not found." });
      return;
    }
    if (challenge.status === "resolved") {
      res.status(400).json({ message: "Challenge already resolved." });
      return;
    }

    const updateData = {};
    if (challenge.challengerId === playerId) {
      updateData.challengerScore = score;
    } else if (challenge.opponentId === playerId) {
      updateData.opponentScore = score;
    } else {
      res.status(403).json({ message: "Not part of this challenge." });
      return;
    }

    const updated = await prisma.pkChallenge.update({
      where: { id: challengeId },
      data: updateData
    });

    const bothSubmitted =
      updated.challengerScore !== null && updated.opponentScore !== null;

    if (!bothSubmitted) {
      res.json({ message: "Score submitted, waiting for opponent.", challenge: updated });
      return;
    }

    const winnerId =
      updated.challengerScore === updated.opponentScore
        ? null
        : updated.challengerScore > updated.opponentScore
          ? updated.challengerId
          : updated.opponentId;

    const resolved = await prisma.pkChallenge.update({
      where: { id: challengeId },
      data: {
        status: "resolved",
        winnerId,
        resolvedAt: new Date()
      }
    });

    if (winnerId && updated.wager > 0) {
      await prisma.player.update({
        where: { id: winnerId },
        data: { tokensLeft: { increment: updated.wager }, seasonPoints: { increment: 10 } }
      });
    }

    res.json({ message: "Challenge resolved.", challenge: resolved });
  } catch (error) {
    respondError(res, "Submit score failed.", error);
  }
});

app.get("/api/social/pk", async (req, res) => {
  try {
    const playerId = String(req.query.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    const challenges = await prisma.pkChallenge.findMany({
      where: { OR: [{ challengerId: playerId }, { opponentId: playerId }] },
      include: {
        challenger: { select: { id: true, name: true } },
        opponent: { select: { id: true, name: true } },
        winner: { select: { id: true, name: true } }
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(challenges);
  } catch (error) {
    respondError(res, "Fetch PK failed.", error);
  }
});

app.post("/api/social/rooms/create", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    const code = nanoid(6).toUpperCase();
    await prisma.$transaction([
      prisma.battleRoom.create({
        data: {
          code,
          hostId: playerId,
          status: "open"
        }
      }),
      prisma.battleRoomEntry.create({
        data: {
          id: nanoid(16),
          roomCode: code,
          playerId,
          score: 0
        }
      })
    ]);

    res.status(201).json({ message: "Room created.", roomCode: code });
  } catch (error) {
    respondError(res, "Create room failed.", error);
  }
});

app.post("/api/social/rooms/join", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const roomCode = String(req.body?.roomCode || "").toUpperCase();

    if (!playerId || !roomCode) {
      res.status(400).json({ message: "playerId and roomCode are required." });
      return;
    }

    const room = await prisma.battleRoom.findUnique({ where: { code: roomCode } });
    if (!room) {
      res.status(404).json({ message: "Room not found." });
      return;
    }
    if (room.status !== "open") {
      res.status(400).json({ message: "Room is closed." });
      return;
    }

    await prisma.battleRoomEntry.upsert({
      where: { roomCode_playerId: { roomCode, playerId } },
      update: {},
      create: {
        id: nanoid(16),
        roomCode,
        playerId,
        score: 0
      }
    });

    res.json({ message: "Joined room.", roomCode });
  } catch (error) {
    respondError(res, "Join room failed.", error);
  }
});

app.post("/api/social/rooms/submit", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const roomCode = String(req.body?.roomCode || "").toUpperCase();
    const score = Number(req.body?.score);

    if (!playerId || !roomCode || !Number.isFinite(score) || score < 0) {
      res.status(400).json({ message: "playerId, roomCode and score are required." });
      return;
    }

    await prisma.battleRoomEntry.upsert({
      where: { roomCode_playerId: { roomCode, playerId } },
      update: { score: Math.floor(score) },
      create: {
        id: nanoid(16),
        roomCode,
        playerId,
        score: Math.floor(score)
      }
    });

    const ranking = await prisma.battleRoomEntry.findMany({
      where: { roomCode },
      include: { player: { select: { id: true, name: true } } },
      orderBy: { score: "desc" }
    });

    res.json({
      message: "Room score submitted.",
      ranking: ranking.map((item) => ({
        playerId: item.playerId,
        name: item.player.name,
        score: item.score
      }))
    });
  } catch (error) {
    respondError(res, "Submit room score failed.", error);
  }
});

app.get("/api/social/rooms/:roomCode", async (req, res) => {
  try {
    const roomCode = String(req.params.roomCode || "").toUpperCase();
    const room = await prisma.battleRoom.findUnique({
      where: { code: roomCode },
      include: {
        entries: {
          include: { player: { select: { id: true, name: true } } },
          orderBy: { score: "desc" }
        }
      }
    });

    if (!room) {
      res.status(404).json({ message: "Room not found." });
      return;
    }

    res.json({
      code: room.code,
      status: room.status,
      createdAt: room.createdAt,
      entries: room.entries.map((entry) => ({
        playerId: entry.playerId,
        name: entry.player.name,
        score: entry.score
      }))
    });
  } catch (error) {
    respondError(res, "Fetch room failed.", error);
  }
});

app.post("/api/social/share", async (req, res) => {
  try {
    const playerId = String(req.body?.playerId || "");
    const burnLogId = req.body?.burnLogId ? String(req.body.burnLogId) : null;
    const title = String(req.body?.title || "Burn Token Battle Report").slice(0, 60);

    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    const burn = burnLogId
      ? await prisma.burnLog.findUnique({ where: { id: burnLogId } })
      : await prisma.burnLog.findFirst({
          where: { playerId },
          orderBy: { createdAt: "desc" }
        });

    if (!burn) {
      res.status(404).json({ message: "No battle report found." });
      return;
    }

    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player) {
      res.status(404).json({ message: "Player not found." });
      return;
    }

    const shareCode = nanoid(10);
    const usedItems = JSON.parse(burn.usedItems || "[]");
    const payload = JSON.stringify({
      outcome: burn.outcome,
      burnAmount: burn.burnAmount,
      delta: burn.delta,
      multiplier: burn.multiplier,
      bossRound: burn.bossRound,
      bossDefeated: burn.bossDefeated,
      usedItems,
      seasonPoints: player.seasonPoints,
      highestTokens: readHighestTokens(player),
      currentTokens: player.tokensLeft,
      inventory: {
        shield: player.inventoryShield,
        double: player.inventoryDouble,
        luckyCharm: player.inventoryLucky
      },
      at: burn.createdAt
    });

    await prisma.shareReport.create({
      data: {
        id: nanoid(16),
        shareCode,
        playerId,
        burnLogId: burn.id,
        title,
        payload
      }
    });

    res.status(201).json({
      message: "Share link created.",
      shareCode,
      sharePath: `/api/social/share/${shareCode}`
    });
  } catch (error) {
    respondError(res, "Create share failed.", error);
  }
});

app.get("/api/social/share/:shareCode", async (req, res) => {
  try {
    const shareCode = String(req.params.shareCode || "");
    const report = await prisma.shareReport.findUnique({
      where: { shareCode },
      include: { player: { select: { id: true, name: true } } }
    });

    if (!report) {
      res.status(404).json({ message: "Shared report not found." });
      return;
    }

    res.json({
      title: report.title,
      shareCode: report.shareCode,
      author: report.player.name,
      createdAt: report.createdAt,
      payload: JSON.parse(report.payload || "{}")
    });
  } catch (error) {
    respondError(res, "Read share failed.", error);
  }
});

app.get("/api/admin/overview", async (req, res) => {
  try {
    const key = String(req.query.key || "");
    if (!adminAuthorized(key)) {
      res.status(401).json({ message: "Unauthorized admin key." });
      return;
    }

    const today = todayKey();
    const [totalPlayers, bannedPlayers, activeToday, activeYesterday, burnsToday, totalTokens] =
      await Promise.all([
        prisma.player.count(),
        prisma.player.count({ where: { isBanned: true } }),
        prisma.player.count({ where: { lastLoginDate: today } }),
        prisma.player.count({
          where: { lastLoginDate: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }
        }),
        prisma.burnLog.count({ where: { createdAt: { gte: new Date(`${today}T00:00:00.000Z`) } } }),
        prisma.player.aggregate({ _sum: { tokensLeft: true } })
      ]);

    const retentionEstimate = activeYesterday
      ? Number((activeToday / activeYesterday).toFixed(3))
      : 0;
    const simulatedPayers = Math.max(1, Math.round(activeToday * 0.08));
    const simulatedRevenue = simulatedPayers * 18;

    res.json({
      runtimeConfig,
      metrics: {
        totalPlayers,
        bannedPlayers,
        dau: activeToday,
        retentionEstimate,
        burnsToday,
        tokenSupply: totalTokens._sum.tokensLeft ?? 0,
        simulatedPayers,
        simulatedRevenue
      }
    });
  } catch (error) {
    respondError(res, "Admin overview failed.", error);
  }
});

app.post("/api/admin/config", async (req, res) => {
  try {
    const key = String(req.body?.key || "");
    if (!adminAuthorized(key)) {
      res.status(401).json({ message: "Unauthorized admin key." });
      return;
    }

    const patch = req.body?.config || {};
    runtimeConfig.jackpotScale = clamp(Number(patch.jackpotScale ?? runtimeConfig.jackpotScale), 0.6, 1.6);
    runtimeConfig.winScale = clamp(Number(patch.winScale ?? runtimeConfig.winScale), 0.6, 1.6);
    runtimeConfig.newPlayerBoostScale = clamp(
      Number(patch.newPlayerBoostScale ?? runtimeConfig.newPlayerBoostScale),
      0.5,
      2
    );
    runtimeConfig.loginRewardScale = clamp(
      Number(patch.loginRewardScale ?? runtimeConfig.loginRewardScale),
      0.5,
      2
    );

    res.json({ message: "Runtime config updated.", runtimeConfig });
  } catch (error) {
    respondError(res, "Update config failed.", error);
  }
});

app.post("/api/admin/compensate", async (req, res) => {
  try {
    const key = String(req.body?.key || "");
    const amount = Number(req.body?.amount);
    if (!adminAuthorized(key)) {
      res.status(401).json({ message: "Unauthorized admin key." });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ message: "Positive amount is required." });
      return;
    }

    const playerId = String(req.body?.playerId || "");
    if (playerId) {
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) {
        res.status(404).json({ message: "Player not found." });
        return;
      }
      const newTokens = player.tokensLeft + Math.floor(amount);
      await prisma.player.update({
        where: { id: playerId },
        data: {
          tokensLeft: { increment: Math.floor(amount) },
          ...(supportsHighestTokens
            ? { highestTokens: newTokens > readHighestTokens(player) ? newTokens : readHighestTokens(player) }
            : {})
        }
      });
      res.json({ message: "Compensation sent to player." });
      return;
    }

    const result = await prisma.player.updateMany({
      where: { isBanned: false },
      data: { tokensLeft: { increment: Math.floor(amount) } }
    });
    res.json({ message: "Compensation broadcast sent.", affected: result.count });
  } catch (error) {
    respondError(res, "Compensate failed.", error);
  }
});

app.post("/api/admin/season/reset", async (req, res) => {
  try {
    const key = String(req.body?.key || "");
    if (!adminAuthorized(key)) {
      res.status(401).json({ message: "Unauthorized admin key." });
      return;
    }

    const seasonId = getSeasonId();
    await prisma.$transaction([
      prisma.player.updateMany({
        data: { seasonPoints: 0, rounds: 0, streak: 0, bestStreak: 0 }
      }),
      prisma.leaderboardEntry.deleteMany({ where: { seasonId } })
    ]);
    res.json({ message: "Season reset completed.", seasonId });
  } catch (error) {
    respondError(res, "Season reset failed.", error);
  }
});

app.post("/api/admin/ban", async (req, res) => {
  try {
    const key = String(req.body?.key || "");
    const playerId = String(req.body?.playerId || "");
    const banned = Boolean(req.body?.banned ?? true);
    if (!adminAuthorized(key)) {
      res.status(401).json({ message: "Unauthorized admin key." });
      return;
    }
    if (!playerId) {
      res.status(400).json({ message: "playerId is required." });
      return;
    }

    await prisma.player.update({
      where: { id: playerId },
      data: { isBanned: banned }
    });
    res.json({ message: banned ? "Player banned." : "Player unbanned." });
  } catch (error) {
    respondError(res, "Ban operation failed.", error);
  }
});

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    log.info("Burn Token API started.", { url: `http://localhost:${PORT}` });
  });
}

export { app, prisma };
export default app;
