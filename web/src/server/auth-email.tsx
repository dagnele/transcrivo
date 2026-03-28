import { render } from "@react-email/render";
import { EmailTemplate } from "@daveyplate/better-auth-ui/server";
import { Resend } from "resend";

import { getSiteUrlString } from "@/lib/site";
import { createLogger } from "@/server/logger";

const logger = createLogger("auth-email");

type VerificationEmailInput = {
  email: string;
  otp: string;
  type: "email-verification" | "sign-in" | "forget-password" | "change-email";
};

const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

function getEmailSubject(type: VerificationEmailInput["type"]) {
  switch (type) {
    case "email-verification":
      return "Verify your Transcrivo email";
    case "sign-in":
      return "Your Transcrivo sign-in code";
    case "forget-password":
      return "Your Transcrivo password reset code";
    case "change-email":
      return "Confirm your new Transcrivo email";
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

function getEmailText(input: VerificationEmailInput) {
  return `${getEmailIntro(input.type)}\n\n${input.otp}\n\nThis code expires in 5 minutes.`;
}

function getEmailPreview(input: VerificationEmailInput) {
  return `${getEmailSubject(input.type)}: ${input.otp}`;
}

async function getEmailHtml(input: VerificationEmailInput) {
  const siteUrl = getSiteUrlString();

  return render(
    <EmailTemplate
      action="Open Transcrivo"
      baseUrl={siteUrl}
      imageUrl={`${siteUrl}/transcrivo.ico`}
      content={
        <>
          {getEmailIntro(input.type)}
          <br />
          <br />
          <strong
            style={{
              display: "inline-block",
              fontSize: "32px",
              fontWeight: 700,
              letterSpacing: "0.4em",
            }}
          >
            {input.otp}
          </strong>
          <br />
          <br />
          This code expires in 5 minutes.
        </>
      }
      heading={getEmailSubject(input.type)}
      preview={getEmailPreview(input)}
      siteName="Transcrivo"
      url={siteUrl}
    />,
  );
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

  if (!resendClient || !resendApiKey) {
    throw new Error("Email verification is enabled but Resend is not configured.");
  }

  const response = await resendClient.emails.send({
    from,
    to: input.email,
    subject: getEmailSubject(input.type),
    html: await getEmailHtml(input),
    text: getEmailText(input),
  });

  if (response.error) {
    throw new Error(`Failed to send verification email: ${response.error.message}`);
  }
}
