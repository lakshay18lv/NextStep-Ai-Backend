const mongoose = require("mongoose");

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  score: { type: Number, default: 0, min: 0, max: 100 },
  attempts: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: null },
    verificationTokenExpires: { type: Date, default: null },
    skills: {
      communication: { type: Number, default: 0 },
      problemSolving: { type: Number, default: 0 },
      technicalKnowledge: { type: Number, default: 0 },
      leadership: { type: Number, default: 0 },
      collaboration: { type: Number, default: 0 },
    },
    skillHistory: [skillSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
