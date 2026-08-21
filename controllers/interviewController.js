const OpenAI = require("openai");
const Interview = require("../models/Interview");
const User = require("../models/User");

let openaiClient = null;

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
      temperature: 0.7,
      top_p: 1,
      presence_penalty: 0.5,
      frequency_penalty: 0.3,
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

    const aiResult = await generateWithOpenAI(payload);
    if (aiResult.questions?.length) {
      return res.json({
        questions: aiResult.questions,
        source: aiResult.source,
      });
    }

    return res.status(503).json({
      message: aiResult.reason || "OpenAI question generation failed",
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
