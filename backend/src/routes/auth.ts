import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { prisma } from "../db.js";
import {
  validateRequest,
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
} from "../utils/validation.js";
import { requireJwtSecret } from "../utils/security.js";
import { authenticateToken } from "../middleware/auth.js";
import type { AuthRequest } from "../middleware/auth.js";
import { sendEmail } from "../utils/email.js";
import { logger } from "../utils/logger.js";

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

const JWT_EXPIRY = "15m";
const REFRESH_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000;

async function getUserTokenVersion(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true },
  });
  return user?.tokenVersion ?? 0;
}

async function signAccessToken(user: { id: string; email: string }): Promise<string> {
  const tokenVersion = await getUserTokenVersion(user.id);
  return jwt.sign({ id: user.id, email: user.email, tokenVersion }, requireJwtSecret(), {
    expiresIn: JWT_EXPIRY,
  });
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString("hex");
}

function generateResetToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

// ── Register ──────────────────────────────────────────────────────────────────

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

    const token = await signAccessToken({ id: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    res.status(201).json({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch (error: unknown) {
    if (isPrismaUniqueViolation(error)) {
      return res.status(400).json({ error: "Email already exists" });
    }
    res.status(500).json({ error: "Failed to register user" });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post("/login", authLimiter, validateRequest(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = await signAccessToken({ id: user.id, email: user.email });
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    res.json({
      token,
      refreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch {
    res.status(500).json({ error: "Login failed" });
  }
});

// ── Refresh Token ─────────────────────────────────────────────────────────────

router.post("/refresh", validateRequest(refreshTokenSchema), async (req, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const newAccessToken = await signAccessToken({ id: user.id, email: user.email });
    const newRefreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS),
      },
    });

    res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken,
      user: { id: user.id, email: user.email, name: user.name },
    });
  } catch {
    res.status(500).json({ error: "Token refresh failed" });
  }
});

// ── Logout (revoke current refresh token) ─────────────────────────────────────

router.post("/logout", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { token: refreshToken, userId: req.user!.id },
        data: { revokedAt: new Date() },
      });
    }
    res.json({ message: "Logged out" });
  } catch {
    res.status(500).json({ error: "Logout failed" });
  }
});

// ── Logout All ────────────────────────────────────────────────────────────────

router.post("/logout-all", authenticateToken, async (req: AuthRequest, res) => {
  try {
    await prisma.refreshToken.updateMany({
      where: { userId: req.user!.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { tokenVersion: { increment: 1 } },
    });
    res.json({ message: "Logged out of all sessions" });
  } catch {
    res.status(500).json({ error: "Logout all failed" });
  }
});

// ── Change Password ───────────────────────────────────────────────────────────

router.post(
  "/change-password",
  authenticateToken,
  validateRequest(changePasswordSchema),
  async (req: AuthRequest, res) => {
    try {
      const { currentPassword, newPassword } = req.body as {
        currentPassword: string;
        newPassword: string;
      };
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }
      const hashed = await bcrypt.hash(newPassword, 10);
      await prisma.user.update({
        where: { id: req.user!.id },
        data: { password: hashed },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: req.user!.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      res.json({ message: "Password changed. Please log in again." });
    } catch {
      res.status(500).json({ error: "Failed to change password" });
    }
  }
);

// ── Forgot Password ───────────────────────────────────────────────────────────

router.post(
  "/forgot-password",
  authLimiter,
  validateRequest(forgotPasswordSchema),
  async (req, res) => {
    try {
      const { email } = req.body as { email: string };
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return res.json({ message: "If that email exists, a reset link has been sent." });
      }

      const token = generateResetToken();
      await prisma.passwordReset.create({
        data: {
          token,
          userId: user.id,
          expiresAt: new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS),
        },
      });

      const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${token}`;
      await sendEmail({
        to: email,
        subject: "GeoFlux Password Reset",
        text: `Reset your password here: ${resetUrl}\n\nThis link expires in 1 hour. If you did not request this, please ignore this email.`,
        html: `<p>Reset your password <a href="${resetUrl}">here</a>.</p><p>This link expires in 1 hour. If you did not request this, please ignore this email.</p>`,
      });

      res.json({ message: "If that email exists, a reset link has been sent." });
    } catch {
      res.status(500).json({ error: "Failed to process password reset request" });
    }
  }
);

// ── Reset Password ────────────────────────────────────────────────────────────

router.post(
  "/reset-password",
  authLimiter,
  validateRequest(resetPasswordSchema),
  async (req, res) => {
    try {
      const { token, password } = req.body as { token: string; password: string };
      const reset = await prisma.passwordReset.findUnique({ where: { token } });

      if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
        return res.status(400).json({ error: "Invalid or expired reset token" });
      }

      const hashed = await bcrypt.hash(password, 10);
      await prisma.user.update({
        where: { id: reset.userId },
        data: { password: hashed, tokenVersion: { increment: 1 } },
      });
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      });
      await prisma.refreshToken.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      res.json({ message: "Password reset successful. Please log in." });
    } catch {
      res.status(500).json({ error: "Failed to reset password" });
    }
  }
);

// ── Verify Email ──────────────────────────────────────────────────────────────

router.post("/verify-email", validateRequest(verifyEmailSchema), async (req, res) => {
  try {
    const { token } = req.body as { token: string };
    let payload: { id: string; email: string };
    try {
      payload = jwt.verify(token, requireJwtSecret()) as { id: string; email: string };
    } catch {
      return res.status(400).json({ error: "Invalid or expired verification token" });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    if (user.emailVerifiedAt) {
      return res.json({ message: "Email already verified" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });

    res.json({ message: "Email verified successfully" });
  } catch {
    res.status(500).json({ error: "Email verification failed" });
  }
});

// ── Resend Verification ───────────────────────────────────────────────────────

router.post(
  "/resend-verification",
  authenticateToken,
  authLimiter,
  async (req: AuthRequest, res) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
      if (!user) return res.status(404).json({ error: "User not found" });
      if (user.emailVerifiedAt) {
        return res.json({ message: "Email already verified" });
      }

      const verifyToken = jwt.sign(
        { id: user.id, email: user.email },
        requireJwtSecret(),
        { expiresIn: "24h" }
      );
      const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/verify-email?token=${verifyToken}`;

      await sendEmail({
        to: user.email,
        subject: "Verify your GeoFlux email",
        text: `Verify your email here: ${verifyUrl}\n\nThis link expires in 24 hours.`,
        html: `<p>Verify your email <a href="${verifyUrl}">here</a>.</p>`,
      });

      res.json({ message: "Verification email sent" });
    } catch {
      res.status(500).json({ error: "Failed to send verification email" });
    }
  }
);

// ── Me ────────────────────────────────────────────────────────────────────────

router.get("/me", authenticateToken, async (req: AuthRequest, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, email: true, name: true, emailVerifiedAt: true, createdAt: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch {
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
