import type { Metadata, Viewport } from "next";
import { Caveat, Fraunces, Fredoka, Nunito } from "next/font/google";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["SOFT", "opsz"],
});

// Handwriting font for AI whiteboard answers when AI handwriting isn't available.
const caveat = Caveat({
  subsets: ["latin"],
  variable: "--font-caveat",
  display: "swap",
});

// Interface and reading text: clear at small sizes, with tabular figures for timers and stats.
/** Rounded and chunky, for the cartoony title screen. */
const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-cartoon",
  display: "swap",
});

/** Reading and interface text: rounded to match the cartoon style, still clear at small sizes. */
const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cram Club — a cozy library to study together",
  description:
    "A calm 3D university library for studying alone or together. Take a desk with a focus timer, ask the Librarian to research a topic, and turn your notes into lessons on a whiteboard.",
};

export const viewport: Viewport = {
  themeColor: "#f5f2ea",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${nunito.variable} ${caveat.variable} ${fredoka.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
