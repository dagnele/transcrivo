import type { Session } from "@/lib/contracts/session";
import type { SessionEvent } from "@/server/db/schema";

export type GenerateSessionSolutionInput = {
  session: Session;
  transcriptEvents: SessionEvent[];
  previousSolutionContent?: string | null;
};
