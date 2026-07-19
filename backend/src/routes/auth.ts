import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../db.js";
import { validateRequest, registerSchema, loginSchema } from "../utils/validation.js";
import { requireJwtSecret } from "../utils/security.js";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication attempts, please try again later." },
});

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "P2002"
  );
}

router.post("/register", authLimiter, validateRequest(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.body as {
      email: string;
      password: string;
      name?: string;
    };

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, name },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email },
      requireJwtSecret(),
      { expiresIn: "24h" }
    );
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueViolation(error)) {
      return res.status(400).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: "Failed to register user" });
  }
});

router.post("/login", authLimiter, validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email },
      requireJwtSecret(),
      { expiresIn: "24h" }
    );
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

export default router;
