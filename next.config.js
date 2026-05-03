/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ["images.unsplash.com", "via.placeholder.com"],
  },
  // The pipeline (orchestrator + AI SDKs) is designed to run LOCALLY via
  // `npm run dev`. Vercel's role is static asset hosting (template videos
  // served at HTTPS URLs that Kling Motion Control can fetch). Without
  // these exclusions the function bundle hits 450MB+ and exceeds Vercel's
  // 300MB cap. Two complementary mechanisms below — Next 14 needs both.
  experimental: {
    // Keep these node packages OUT of the function bundle; they're required
    // at runtime when the route is invoked locally.
    serverComponentsExternalPackages: [
      "@google/genai",
      "@google-cloud/vertexai",
      "google-auth-library",
      "google-gax",
      "grpc-gcp",
      "protobufjs",
      "fluent-ffmpeg",
      "@vercel/blob",
    ],
    // Belt-and-braces: also exclude from output file tracing. The big
    // contributor is `public/` — Next.js's tracer follows the `readFileSync`
    // calls in the orchestrator and pulls every template/product asset into
    // the function bundle (60MB videos × 5 templates = ~300MB). Since the
    // pipeline runs locally only, the function never reads these on Vercel.
    outputFileTracingExcludes: {
      "*": [
        "public/**",
        "test-fixtures/**",
        "scripts/**",
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
  },
};

module.exports = nextConfig;
