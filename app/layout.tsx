import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://openagent.hk"),
  title: "BRAIN / 27｜脑科学与 AI 机会雷达",
  description: "面向 2027 实验心理学硕士的博士、全奖、科研助理、高校研究岗位与校招机会清单。",
  openGraph: {
    title: "BRAIN / 27｜学术机会雷达",
    description: "双语论文、顶尖导师、研究方向、截止日期与全球学术机会。",
    url: "https://openagent.hk",
    siteName: "BRAIN / 27",
    locale: "zh_CN",
    type: "website",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "BRAIN / 27 学术机会雷达" }],
  },
  twitter: { card: "summary_large_image", title: "BRAIN / 27｜学术机会雷达", description: "论文、导师、机会与截止日期一站式跟踪。", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
