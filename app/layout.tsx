import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BRAIN / 27｜脑科学与 AI 机会雷达",
  description: "面向 2027 实验心理学硕士的博士、全奖、科研助理、高校研究岗位与校招机会清单。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
