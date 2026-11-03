import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "观舌 · 舌象健康观察 Agent",
  description: "从舌象观察与日常感受开始，通过对话整理健康信息。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
