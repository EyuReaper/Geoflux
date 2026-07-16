import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { app, prisma, redis } from "../src/index.js";

// Optional: Mock Redis if it's not available in the environment
vi.mock("../src/utils/redis.js", async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    redis: {
      ping: vi.fn().mockResolvedValue("PONG"),
      get: vi.fn(),
      setex: vi.fn().mockResolvedValue("OK"),
      del: vi.fn(),
      quit: vi.fn().mockResolvedValue("OK"),
      getBuffer: vi.fn(),
      publish: vi.fn().mockResolvedValue(1),
    },
    pubsub: {
      subscribe: vi.fn(),
      on: vi.fn(),
      quit: vi.fn().mockResolvedValue("OK"),
    }
  };
});

describe("Integration Tests", () => {
  beforeAll(async () => {
    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    await prisma.$disconnect();
    // Use the mocked redis quit
    await redis.quit();
  }, 30000);

  describe("Health Check", () => {
    it("should return 200 and healthy status", async () => {
      const response = await request(app).get("/health");
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        services: {
          database: "up",
          redis: "up"
        }
      });
    }, 20000);
  });

  describe("Auth Routes", () => {
    const testUser = {
      email: `test-${Date.now()}@example.com`,
      password: "password123",
      name: "Test User"
    };

    it("should register a new user", async () => {
      const response = await request(app)
        .post("/register")
        .send(testUser);

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty("token");
      expect(response.body.user.email).toBe(testUser.email);
    });

    it("should login the registered user", async () => {
      const response = await request(app)
        .post("/login")
        .send({
          email: testUser.email,
          password: testUser.password
        });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("token");
    });

    it("should fail login with wrong password", async () => {
      const response = await request(app)
        .post("/login")
        .send({
          email: testUser.email,
          password: "wrongpassword"
        });

      expect(response.status).toBe(401);
    });
  });

  describe("Dataset Routes (Protected)", () => {
    let token: string;

    beforeAll(async () => {
      const loginRes = await request(app)
        .post("/register")
        .send({
          email: `protected-${Date.now()}@example.com`,
          password: "password123"
        });
      token = loginRes.body.token;
    });

    it("should return 401 if no token provided", async () => {
      const response = await request(app).get("/datasets");
      expect(response.status).toBe(401);
    });

    it("should create a new dataset", async () => {
      const response = await request(app)
        .post("/datasets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Test Dataset",
          color: "#ff0000",
          type: "points",
          data: [
            { lat: 10, lng: 20, value: 100, category: "A" }
          ]
        });

      expect(response.status).toBe(201);
      expect(response.body.name).toBe("Test Dataset");
      expect(response.body).toHaveProperty("id");
    });

    it("should reject unauthenticated tile access", async () => {
      const createRes = await request(app)
        .post("/datasets")
        .set("Authorization", `Bearer ${token}`)
        .send({
          name: "Tile Auth Dataset",
          color: "#00ff00",
          type: "points",
          data: [{ lat: 1, lng: 2, value: 10, category: "B" }],
        });

      expect(createRes.status).toBe(201);
      const datasetId = createRes.body.id;

      const unauth = await request(app).get(
        `/datasets/${datasetId}/tiles/0/0/0.pbf?min=0&max=100&cats=&search=`
      );
      expect(unauth.status).toBe(401);

      const auth = await request(app)
        .get(`/datasets/${datasetId}/tiles/0/0/0.pbf?min=0&max=100&cats=&search=`)
        .set("Authorization", `Bearer ${token}`);
      // 200 (tile), 204 (empty), or 500 if PostGIS tile helpers unavailable in CI
      expect([200, 204, 500]).toContain(auth.status);
      if (auth.status !== 500) {
        expect(auth.status).not.toBe(401);
        expect(auth.status).not.toBe(403);
      }
    });
  });
});
