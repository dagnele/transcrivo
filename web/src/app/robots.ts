import type { MetadataRoute } from "next";

import { getSiteUrlString } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrlString();

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/install"],
        disallow: ["/auth/", "/sessions/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
