/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["images.unsplash.com", "via.placeholder.com"],
  },
  // The pipeline routes (orchestrator + AI SDKs) are designed to run LOCALLY
  // via `npm run dev`. Vercel's role is static asset hosting (template videos
  // served at HTTPS URLs that Kling Motion Control can fetch). Without these
  // exclusions the function bundle hits 450MB+ and exceeds Vercel's 300MB cap.
  // Tell the tracer not to bundle the heavy SDKs into the function output.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@google-cloud/**",
      "node_modules/@google/**",
      "node_modules/google-auth-library/**",
      "node_modules/google-gax/**",
      "node_modules/grpc-gcp/**",
      "node_modules/protobufjs/**",
      "node_modules/long/**",
      "node_modules/google-logging-utils/**",
      "node_modules/fluent-ffmpeg/**",
      "node_modules/dotenv/**",
      "node_modules/dotenvx/**",
    ],
  },
};

module.exports = nextConfig;
