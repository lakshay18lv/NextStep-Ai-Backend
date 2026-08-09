const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendVerificationEmail } = require("../utils/emailService");

const createToken = (userId) => {
  const secret = process.env.JWT_SECRET;
  const expiresIn = process.env.JWT_EXPIRES_IN;

  if (!secret) {
    throw new Error("JWT_SECRET is missing from environment variables.");
  }

  return jwt.sign({ id: userId }, secret, { expiresIn });
};

const normalizeEmail = (value) => String(value || "").toLowerCase().trim();

const buildVerificationToken = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  return {
    rawToken,
    hashedToken,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
};

const buildVerificationLink = (email, token) => {
  const baseUrl = String(
    process.env.APP_BASE_URL ||
      process.env.SERVER_URL ||
      process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      "http://localhost:5173",
  ).replace(/\/$/, "");

  return `${baseUrl}/verify-email?email=${encodeURIComponent(
    email,
  )}&token=${encodeURIComponent(token)}`;
};

const issueVerificationEmail = async ({ user, rawToken }) => {
  const verificationLink = buildVerificationLink(user.email, rawToken);

  try {
    await sendVerificationEmail({
      email: user.email,
      name: user.name,
      token: rawToken,
      verificationLink,
    });
    return { sent: true, verificationLink };
  } catch (error) {
    console.error("Verification email failed:", error.message);
    return { sent: false, verificationLink };
  }
};

const register = async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser && existingUser.isVerified) {
      return res.status(409).json({ message: "User already exists" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const { rawToken, hashedToken, expiresAt } = buildVerificationToken();

    let user = existingUser;
    if (user) {
      user.name = name;
      user.password = hashedPassword;
      user.isVerified = false;
      user.verificationToken = hashedToken;
      user.verificationTokenExpires = expiresAt;
    } else {
      user = new User({
        name,
        email,
        password: hashedPassword,
        isVerified: false,
        verificationToken: hashedToken,
        verificationTokenExpires: expiresAt,
      });
    }

    await user.save();
    const emailResult = await issueVerificationEmail({ user, rawToken });

    return res.status(existingUser ? 200 : 201).json({
      message: emailResult.sent
        ? "Verification email sent. Please check your inbox."
        : "Account created, but email could not be sent. Use the verification link shown in development.",
      requiresVerification: true,
      email: user.email,
      verificationToken:
        process.env.NODE_ENV === "production" ? undefined : rawToken,
      verificationLink:
        process.env.NODE_ENV === "production"
          ? undefined
          : emailResult.verificationLink,
    });
  } catch (err) {
    return next(err);
  }
};

const login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Please verify your email before logging in.",
        requiresVerification: true,
        email: user.email,
      });
    }

    const token = createToken(user._id);

    return res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    return next(err);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email || req.query.email);
    const token = String(req.body.token || req.query.token || "").trim();

    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = email
      ? await User.findOne({ email, verificationToken: hashedToken })
      : await User.findOne({ verificationToken: hashedToken });

    if (!user) {
      return res.status(404).json({
        message: "Verification link is invalid or has already been used.",
      });
    }

    if (user.isVerified) {
      const tokenValue = createToken(user._id);
      return res.json({
        message: "Account already verified.",
        token: tokenValue,
        user: { id: user._id, name: user.name, email: user.email },
      });
    }

    if (
      !user.verificationTokenExpires ||
      user.verificationTokenExpires < new Date()
    ) {
      return res.status(400).json({
        message: "Verification link has expired. Please resend the email.",
      });
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save();

    const tokenValue = createToken(user._id);
    return res.json({
      message: "Email verified successfully.",
      token: tokenValue,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    return next(err);
  }
};

const resendVerificationEmail = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    const { rawToken, hashedToken, expiresAt } = buildVerificationToken();
    user.verificationToken = hashedToken;
    user.verificationTokenExpires = expiresAt;
    await user.save();

    const emailResult = await issueVerificationEmail({ user, rawToken });

    return res.json({
      message: emailResult.sent
        ? "Verification email sent again."
        : "Verification token regenerated. Email service is not configured.",
      verificationToken:
        process.env.NODE_ENV === "production" ? undefined : rawToken,
      verificationLink:
        process.env.NODE_ENV === "production"
          ? undefined
          : emailResult.verificationLink,
    });
  } catch (err) {
    return next(err);
  }
};

const getUser = async (req, res, next) => {
  try {
    return res.json({ user: req.user });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  resendVerificationEmail,
  getUser,
};
