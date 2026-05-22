export const START_TOKENS = 1000;
export const MAX_HISTORY = 12;
export const BURN_COOLDOWN_MS = 800;
export const BOSS_ROUND_INTERVAL = 5;
export const BOSS_BONUS_REWARD = 180;
export const BOSS_FAIL_PENALTY = 40;
export const ECONOMY_BALANCE_MAX_BIAS = 0.18;
export const ECONOMY_BALANCE_TAIL_KEEP_PERCENT = 0.05;
export const NEW_PLAYER_BOOST_ROUNDS = 15;
export const NEW_PLAYER_BOOST_MAX = 0.12;

export const PROBABILITY = {
  base: {
    jackpot: 0.06,
    win: 0.26,
    neutral: 0.72
  },
  luckyCharm: {
    jackpot: 0.08,
    win: 0.33,
    neutral: 0.84
  }
};

export const DAILY_QUESTS = [
  {
    id: "burn-3",
    title: "燃烧新手",
    description: "完成 3 次燃烧",
    target: 3,
    reward: 120,
    metric: "dailyRounds"
  },
  {
    id: "win-2",
    title: "手气不错",
    description: "触发 2 次 WIN/JACKPOT",
    target: 2,
    reward: 150,
    metric: "dailyWins"
  },
  {
    id: "jackpot-1",
    title: "天选之人",
    description: "触发 1 次 JACKPOT",
    target: 1,
    reward: 300,
    metric: "dailyJackpots"
  }
];

export const ACHIEVEMENTS = [
  {
    code: "FIRST_BURN",
    title: "第一把火",
    condition: (player) => player.rounds >= 1
  },
  {
    code: "STREAK_3",
    title: "三连胜",
    condition: (player) => player.bestStreak >= 3
  },
  {
    code: "TOKEN_2K",
    title: "两千富豪",
    condition: (player) => player.tokensLeft >= 2000
  }
];
