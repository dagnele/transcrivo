import { redirect } from "next/navigation";

import { getOptionalSession } from "@/server/auth-session";

export default async function HomePage() {
  const session = await getOptionalSession();

  redirect(session ? "/sessions" : "/auth/sign-in");
}
