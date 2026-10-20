import type { Metadata } from "next";
import "./globals.css";
import "./local-studio.css";
import "./ai-studio.css";
export const metadata: Metadata = {
  title: "Song · AI 音乐工作台",
  description: "从一句灵感，到一首完整的歌。你的本地音乐创作空间。",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
