import { createLogger } from "@/server/logger";

const logger = createLogger("auth-email");

type VerificationEmailInput = {
  email: string;
  otp: string;
  type: "email-verification" | "sign-in" | "forget-password" | "change-email";
};

const resendApiUrl = "https://api.resend.com/emails";

function getEmailSubject(type: VerificationEmailInput["type"]) {
  switch (type) {
    case "email-verification":
      return "Verify your Cheatcode email";
    case "sign-in":
      return "Your Cheatcode sign-in code";
    case "forget-password":
      return "Your Cheatcode password reset code";
    case "change-email":
      return "Confirm your new Cheatcode email";
  }
}

function getEmailIntro(type: VerificationEmailInput["type"]) {
  switch (type) {
    case "email-verification":
      return "Use this code to verify your email address.";
    case "sign-in":
      return "Use this code to finish signing in.";
    case "forget-password":
      return "Use this code to reset your password.";
    case "change-email":
      return "Use this code to confirm your new email address.";
  }
}

function getEmailHtml(input: VerificationEmailInput) {
  const intro = getEmailIntro(input.type);

  return `
    <div style="font-family: Arial, sans-serif; padding: 24px; color: #111827; line-height: 1.5;">
      <p style="margin: 0 0 12px; font-size: 16px;">${intro}</p>
      <p style="margin: 0 0 20px; font-size: 32px; font-weight: 700; letter-spacing: 0.4em;">${input.otp}</p>
      <p style="margin: 0; font-size: 14px; color: #4b5563;">This code expires in 5 minutes.</p>
    </div>
  `;
}

function getEmailText(input: VerificationEmailInput) {
  return `${getEmailIntro(input.type)}\n\n${input.otp}\n\nThis code expires in 5 minutes.`;
}

export async function sendVerificationEmail(input: VerificationEmailInput) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_EMAIL_FROM;

  if (!resendApiKey || !from) {
    if (process.env.NODE_ENV !== "production") {
      logger.info(
        { email: input.email, otp: input.otp, type: input.type },
        "Using development email fallback",
      );
      return;
    }

    throw new Error(
      "Email verification is enabled but RESEND_API_KEY or AUTH_EMAIL_FROM is missing.",
    );
  }

  const response = await fetch(resendApiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.email,
      subject: getEmailSubject(input.type),
      html: getEmailHtml(input),
      text: getEmailText(input),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to send verification email: ${response.status}`);
  }
}
