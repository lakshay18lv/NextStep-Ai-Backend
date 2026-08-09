const nodemailer = require("nodemailer");

const normalizeEnv = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, "");

const getTransporter = () => {
  const user = normalizeEnv(process.env.SMTP_USER || process.env.EMAIL_USER);
  const pass = normalizeEnv(
    process.env.SMTP_PASS || process.env.EMAIL_APP_PASSWORD,
  );

  if (!user || !pass) {
    throw new Error("Email credentials are missing. Set SMTP_USER and SMTP_PASS.");
  }

  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
    port === 465;

  return nodemailer.createTransport(
    host
      ? {
          host,
          port,
          secure,
          auth: { user, pass },
        }
      : {
          service: "gmail",
          auth: { user, pass },
        },
  );
};

const sendVerificationEmail = async ({
  email,
  name = "",
  token,
  verificationLink,
}) => {
  const transporter = getTransporter();
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
  const baseUrl = String(
    process.env.FRONTEND_URL ||
      process.env.CLIENT_URL ||
      process.env.APP_BASE_URL ||
      "http://localhost:5173",
  ).replace(/\/$/, "");
  const verifyLink =
    verificationLink ||
    `${baseUrl}/verify-email?email=${encodeURIComponent(
      email,
    )}&token=${encodeURIComponent(token)}`;

  const mailOptions = {
    from,
    to: email,
    subject: "NextStep - Verify your email",
    text: `Hi ${name || ""}\n\nYour verification link: ${verifyLink}\n\nThis link expires in 24 hours.`,
    html: `<p>Hi ${name || ""},</p><p>Welcome to NextStep AI.</p><p>Click to verify your email:</p><p><a href="${verifyLink}">Verify email</a></p><p>This link expires in 24 hours.</p>`,
  };

  const info = await transporter.sendMail(mailOptions);
  return { sent: true, info, verifyLink };
};

module.exports = { sendVerificationEmail };
