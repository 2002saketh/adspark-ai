/// <reference types="@cloudflare/workers-types" />

interface CloudflareEnv {
  DB: D1Database;
  AI: Ai;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
  APP_ORIGIN?: string;
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  RAZORPAY_ENVIRONMENT: "test" | "live";
  CLOUDFLARE_AI_MODEL: string;
  CLOUDFLARE_IMAGE_MODEL: string;
}
