import "./globals.css";

export const metadata = {
  title: "Luna Chat",
  description: "A minimal ChatGPT-style client powered by your ChatGPT Codex subscription.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
