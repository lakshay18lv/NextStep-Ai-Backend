const mongoose = require("mongoose");

const MONGO_URI =
  process.env.MONGO_URI || process.env.MONGODB_URI || process.env.MONGO_URL;
const MONGO_URI_LOCAL =
  process.env.MONGO_URI_LOCAL || "mongodb://127.0.0.1:27017/nextstep_ai";

const connectDatabase = async () => {
  try {
    if (!MONGO_URI) {
      throw new Error(
        "Primary MongoDB URI is missing from environment variables.",
      );
    }

    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");
  } catch (primaryErr) {
    const shouldTryFallback = /querySrv|ENOTFOUND|EAI_AGAIN|EREFUSED/i.test(
      primaryErr?.message || "",
    );

    if (!shouldTryFallback) {
      throw primaryErr;
    }

    if (!MONGO_URI_LOCAL) {
      throw new Error("Local MongoDB fallback URI is missing.");
    }

    await mongoose.connect(MONGO_URI_LOCAL);
    console.log("Local MongoDB connected");
  }
};

module.exports = { connectDatabase };
