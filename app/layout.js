import "./globals.css";
import "./smart.css";

export const metadata = {
  title: "Family GPT",
  description: "A ChatGPT-style family client powered by a shared ChatGPT Plus Codex session with Terra, Luna, Sol, and optional web search.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
