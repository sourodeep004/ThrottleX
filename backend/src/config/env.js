
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(5000),

  MONGODB_URI: z
    .string()
    .trim()
    .min(1, "MONGODB_URI is required")
    .refine(
      (value) => {
        try {
          const url = new URL(value);
          return (
            ["mongodb:", "mongodb+srv:"].includes(url.protocol) &&
            Boolean(url.hostname)
          );
        } catch {
          return false;
        }
      },
      "MONGODB_URI must be a valid MongoDB connection URL"
    ),

  REDIS_URL: z
    .string()
    .trim()
    .url("REDIS_URL must be a valid URL")
    .refine(
      (value) => ["redis:", "rediss:"].includes(new URL(value).protocol),
      "REDIS_URL must use the redis:// or rediss:// protocol"
    ),

  CLIENT_URL: z
    .string()
    .trim()
    .url("CLIENT_URL must be a valid URL")
    .default("http://localhost:5173"),

  SHUTDOWN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(10000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error("Invalid environment configuration:");

  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join(".")}: ${issue.message}`);
  }

  process.exit(1);
}

export const env = Object.freeze(result.data);
