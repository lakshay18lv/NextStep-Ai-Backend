const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/auth");
const {
  generateQuestions,
  createInterview,
  listInterviews,
  deleteInterview,
  clearInterviews,
} = require("../controllers/interviewController");

// POST - Generate questions
router.post("/generate", authMiddleware, generateQuestions);

// GET - List all interviews
router.get("/", authMiddleware, listInterviews);

// DELETE - Clear all interviews
router.delete("/", authMiddleware, clearInterviews);

// POST - Create interview
router.post("/", authMiddleware, createInterview);

// DELETE - Delete specific interview
router.delete("/:id", authMiddleware, deleteInterview);

module.exports = router;
