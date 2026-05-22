import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";

let app;
let prisma;

const resetDatabase = async () => {
  await prisma.shareReport.deleteMany();
  await prisma.battleRoomEntry.deleteMany();
  await prisma.battleRoom.deleteMany();
  await prisma.pkChallenge.deleteMany();
  await prisma.friendship.deleteMany();
  await prisma.leaderboardEntry.deleteMany();
  await prisma.achievementUnlock.deleteMany();
  await prisma.questClaim.deleteMany();
  await prisma.burnLog.deleteMany();
  await prisma.player.deleteMany();
};

const createSession = async (name) => {
  const response = await request(app).post("/api/auth/session").send({ name });
  expect(response.status).toBe(200);
  return response.body.playerId;
};

describe("burn token API", () => {
  beforeAll(async () => {
    const mod = await import("../src/server.js");
    app = mod.app;
    prisma = mod.prisma;
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("returns health status", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("creates session and returns state", async () => {
    const response = await request(app).post("/api/auth/session").send({ name: "TesterA" });
    expect(response.status).toBe(200);
    expect(response.body.playerId).toBeTruthy();
    expect(response.body.state.tokensLeft).toBeGreaterThan(0);
  });

  it("supports consecutive burn requests", async () => {
    const playerId = await createSession("BurnTester");
    const body = { playerId, amount: 10, useItems: [] };
    const first = await request(app).post("/api/game/burn").send(body);
    const second = await request(app).post("/api/game/burn").send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("supports social friend and room APIs", async () => {
    const playerA = await createSession("SocialA");
    const playerB = await createSession("SocialB");

    const friend = await request(app)
      .post("/api/social/friends/add")
      .send({ playerId: playerA, friendId: playerB });
    expect(friend.status).toBe(201);

    const room = await request(app)
      .post("/api/social/rooms/create")
      .send({ playerId: playerA });
    expect(room.status).toBe(201);
    expect(room.body.roomCode).toHaveLength(6);
  });

  it("allows admin overview with valid key", async () => {
    await createSession("AdminMetricUser");
    const unauthorized = await request(app).get("/api/admin/overview").query({ key: "bad" });
    expect(unauthorized.status).toBe(401);

    const authorized = await request(app)
      .get("/api/admin/overview")
      .query({ key: process.env.ADMIN_KEY || "test-admin" });
    expect(authorized.status).toBe(200);
    expect(authorized.body.metrics.totalPlayers).toBeGreaterThanOrEqual(1);
  });
});
