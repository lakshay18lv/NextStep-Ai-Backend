const express = require("express");
const {
  register,
  login,
  verifyEmail,
  resendVerificationEmail,
  getUser,
} = require("../controllers/authController");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerificationEmail);
router.get("/user", authMiddleware, getUser);

module.exports = router;
