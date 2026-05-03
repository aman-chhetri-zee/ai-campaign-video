import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Creatify AI | AI-Powered Video Generation",
  description: "Create stunning AI-generated campaign videos in minutes. Select templates, upload products, and let AI do the magic.",
  keywords: ["AI", "video generation", "campaign", "marketing", "creative"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="bg-background-primary text-text-primary antialiased">
        {children}
      </body>
    </html>
  );
}
