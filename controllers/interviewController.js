const crypto = require("crypto");
const OpenAI = require("openai");
const Interview = require("../models/Interview");
const User = require("../models/User");

let openaiClient = null;
const questionCache = new Map();

const getOpenAIClient = () => {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
};

const parseQuestionList = (raw) => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => typeof item === "string" && item.trim())
        .slice(0, 10);
    }
  } catch (err) {
    const match = raw.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item) => typeof item === "string" && item.trim())
            .slice(0, 10);
        }
      } catch (innerErr) {
        return [];
      }
    }
  }
  return [];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "your",
  "from",
  "that",
  "this",
  "have",
  "about",
  "into",
  "will",
  "what",
  "when",
  "where",
  "how",
  "why",
  "are",
  "was",
  "were",
  "been",
  "you",
  "our",
  "their",
  "they",
  "them",
  "can",
  "could",
  "should",
  "would",
  "more",
  "than",
  "then",
  "not",
  "use",
  "used",
  "using",
  "resume",
  "experience",
  "skills",
  "skill",
  "project",
  "projects",
  "team",
  "worked",
  "work",
]);

const extractKeywords = (text = "") => {
  const tokens = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 2 && !STOP_WORDS.has(item));

  const frequencies = new Map();
  tokens.forEach((token) => {
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  });

  return [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
};

const titleCase = (value = "") =>
  String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim() || "the role";

const buildFallbackQuestions = ({ resumeText, difficulty, domain }) => {
  const keywords = extractKeywords(resumeText);
  const focus = keywords.length ? keywords[0] : titleCase(domain);
  const secondary = keywords[1] || focus;
  const tertiary = keywords[2] || secondary;
  const level = String(difficulty || "medium").toLowerCase();

  const templates = {
    easy: [
      `Can you explain your experience with ${focus} in simple terms?`,
      `What part of your work on ${secondary} are you most comfortable with?`,
      `Describe a project where you used ${focus} and what you learned from it.`,
      `How do you usually start when working on ${focus}?`,
      `What tools or technologies helped you most when working with ${secondary}?`,
      `Tell me about a time you collaborated on a ${domain || "project"} task.`,
      `What motivated you to learn ${focus}?`,
      `Which part of ${secondary} felt hardest at first, and how did you improve?`,
      `How would you explain ${focus} to someone new to the field?`,
      `What is one simple win you achieved while working on ${domain || "this domain"}?`,
    ],
    medium: [
      `Describe a project where you used ${focus} and explain the trade-offs you made.`,
      `How did you handle a challenge while working on ${secondary}?`,
      `What is one technical decision you made in a ${domain || "recent"} project and why?`,
      `How do you balance speed and quality when delivering work related to ${focus}?`,
      `What would you improve if you had more time on your ${tertiary} project?`,
      `How do you measure whether your solution is successful in ${domain || "this domain"}?`,
      `How did you collaborate with others while working on ${focus}?`,
      `What constraints affected your approach to ${secondary}?`,
      `How would you explain the impact of your ${domain || "project"} work to a non-technical person?`,
      `What part of ${tertiary} required the most problem-solving from you?`,
    ],
    hard: [
      `Tell me about a difficult ${domain || "technical"} problem you solved using ${focus}, and why your approach was the best option.`,
      `If a senior engineer challenged your design for ${secondary}, how would you defend it?`,
      `How would you redesign your ${tertiary} solution if traffic or scale increased 10x?`,
      `What trade-offs did you consider between performance, maintainability, and delivery time in a ${domain || "project"}?`,
      `How would you mentor a junior teammate who struggled with ${focus}?`,
      `What metric would prove that your work on ${secondary} had business impact?`,
      `How would you troubleshoot a critical failure in a system related to ${focus} under time pressure?`,
      `What would you do if your original solution for ${secondary} no longer met business needs?`,
      `How would you justify investing more engineering time into ${domain || "this area"}?`,
      `What is the most complex trade-off you made in a ${domain || "project"} and why?`,
    ],
  };

  return templates[level] || templates.medium;
};

const buildQuestionCacheKey = ({ userId, resumeText, difficulty, domain }) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        userId: String(userId || ""),
        resumeText: String(resumeText || "").trim().toLowerCase(),
        difficulty: String(difficulty || "medium").trim().toLowerCase(),
        domain: String(domain || "General").trim().toLowerCase(),
      }),
    )
    .digest("hex");

const generateWithOpenAI = async ({ resumeText, difficulty, domain }) => {
  const client = getOpenAIClient();
  if (!client) {
    return {
      questions: null,
      source: "openai",
      reason: "OPENAI_API_KEY missing",
    };
  }

  try {
    const response = await client.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are an expert interview coach. Return only a JSON array of 10 interview questions.",
          },
          {
            role: "user",
            content: `
Target domain: ${domain}
Difficulty: ${difficulty}
Resume text: ${resumeText || "No resume text provided."}

Rules:
- easy questions should be simple and beginner friendly
- medium questions should be practical and moderately deep
- hard questions should include trade-offs, impact, and advanced reasoning
- questions must clearly differ across difficulty levels
- return JSON array only
            `.trim(),
          },
        ],
        temperature: 0,
    });

    const content = response?.choices?.[0]?.message?.content;
    const questions = parseQuestionList(content);
    if (!questions.length) {
      return {
        questions: null,
        source: "openai",
        reason: "OpenAI returned invalid format",
      };
    }

    return { questions, source: "openai", reason: null };
  } catch (err) {
    return { questions: null, source: "openai", reason: err.message };
  }
};

const normalizeList = (items, fallback = "Not answered") =>
  Array.isArray(items)
    ? items.map((item) => {
        const value = String(item || "").trim();
        return value || fallback;
      })
    : [];

const buildSkillScores = ({ score, strengths, improvements }) => {
  const safeScore = Math.max(0, Math.min(100, Number(score) || 0));
  const boost = Array.isArray(strengths)
    ? Math.min(strengths.length * 2, 8)
    : 0;
  const penalty = Array.isArray(improvements)
    ? Math.min(improvements.length * 2, 10)
    : 0;

  return {
    communication: Math.max(0, Math.min(100, safeScore + boost - penalty)),
    problemSolving: Math.max(0, Math.min(100, safeScore + 4 - penalty)),
    technicalKnowledge: Math.max(0, Math.min(100, safeScore + 2 - penalty)),
    leadership: Math.max(0, Math.min(100, safeScore - 4 + boost)),
    collaboration: Math.max(0, Math.min(100, safeScore - 2 + boost)),
  };
};

const generateQuestions = async (req, res, next) => {
  try {
    const payload = {
      resumeText: req.body.resumeText || "",
      difficulty: req.body.difficulty || "medium",
      domain: req.body.domain || "General",
    };

    const cacheKey = buildQuestionCacheKey({
      userId: req.user?._id,
      ...payload,
    });

    if (questionCache.has(cacheKey)) {
      const cached = questionCache.get(cacheKey);
      return res.json({
        questions: cached.questions,
        source: cached.source,
        cached: true,
      });
    }

    const aiResult = await generateWithOpenAI(payload);
    if (aiResult.questions?.length) {
      questionCache.set(cacheKey, {
        questions: aiResult.questions,
        source: aiResult.source,
      });
      return res.json({
        questions: aiResult.questions,
        source: aiResult.source,
      });
    }

    const fallbackQuestions = buildFallbackQuestions(payload);
    questionCache.set(cacheKey, {
      questions: fallbackQuestions,
      source: "fallback",
    });
    return res.json({
      questions: fallbackQuestions,
      source: "fallback",
      message: aiResult.reason || "OpenAI unavailable, used fallback generator",
    });
  } catch (err) {
    return next(err);
  }
};

const createInterview = async (req, res, next) => {
  try {
    const {
      score,
      feedback,
      summary,
      domain,
      difficulty,
      questions,
      answers,
      strengths,
      improvements,
    } = req.body;

    if (score === undefined || !feedback || !domain || !difficulty) {
      return res.status(400).json({
        message: "Score, feedback, domain, and difficulty are required",
      });
    }

    const normalizedQuestions = normalizeList(questions, "").filter(Boolean);
    const normalizedAnswers = normalizeList(answers, "Not answered");
    const normalizedStrengths = normalizeList(strengths, "").filter(Boolean);
    const normalizedImprovements = normalizeList(improvements, "").filter(
      Boolean,
    );

    if (!normalizedQuestions.length) {
      return res.status(400).json({ message: "Questions are required" });
    }

    const interview = await Interview.create({
      score: Number(score) || 0,
      feedback: String(feedback).trim(),
      summary: String(summary || feedback).trim(),
      domain: String(domain).trim(),
      difficulty: String(difficulty).trim().toLowerCase(),
      questions: normalizedQuestions,
      answers: normalizedAnswers,
      strengths: normalizedStrengths,
      improvements: normalizedImprovements,
      user: req.user._id,
    });

    const computedSkills = buildSkillScores({
      score: interview.score,
      strengths: normalizedStrengths,
      improvements: normalizedImprovements,
    });

    await User.findByIdAndUpdate(req.user._id, {
      $set: {
        "skills.communication": computedSkills.communication,
        "skills.problemSolving": computedSkills.problemSolving,
        "skills.technicalKnowledge": computedSkills.technicalKnowledge,
        "skills.leadership": computedSkills.leadership,
        "skills.collaboration": computedSkills.collaboration,
      },
      $push: {
        skillHistory: {
          $each: [
            {
              name: "communication",
              score: computedSkills.communication,
              attempts: 1,
              lastUpdated: new Date(),
            },
            {
              name: "problemSolving",
              score: computedSkills.problemSolving,
              attempts: 1,
              lastUpdated: new Date(),
            },
            {
              name: "technicalKnowledge",
              score: computedSkills.technicalKnowledge,
              attempts: 1,
              lastUpdated: new Date(),
            },
            {
              name: "leadership",
              score: computedSkills.leadership,
              attempts: 1,
              lastUpdated: new Date(),
            },
            {
              name: "collaboration",
              score: computedSkills.collaboration,
              attempts: 1,
              lastUpdated: new Date(),
            },
          ],
        },
      },
    });

    return res.status(201).json({ interview });
  } catch (err) {
    return next(err);
  }
};

const listInterviews = async (req, res, next) => {
  try {
    const interviews = await Interview.find({ user: req.user._id }).sort({
      createdAt: -1,
    });
    return res.json({ interviews });
  } catch (err) {
    return next(err);
  }
};

const clearInterviews = async (req, res, next) => {
  try {
    await Interview.deleteMany({ user: req.user._id });
    return res.json({ message: "Interview history cleared" });
  } catch (err) {
    return next(err);
  }
};

const deleteInterview = async (req, res, next) => {
  try {
    const deleted = await Interview.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Interview not found" });
    }

    return res.json({ message: "Interview removed" });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  generateQuestions,
  createInterview,
  listInterviews,
  clearInterviews,
  deleteInterview,
};
