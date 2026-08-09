const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/authRoutes");
const interviewRoutes = require("./routes/interviewRoutes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

app.use(express.json());
app.use(cors());

app.get("/", (req, res) => {
  res.json({ message: "NextStep AI API is running." });
});

app.use("/api/auth", authRoutes);
app.use("/api/interviews", interviewRoutes);

app.use(errorHandler);

module.exports = app;
