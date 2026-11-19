import type { Metadata } from "next";
import { LibraryClient } from "./LibraryClient";

export const metadata: Metadata = {
  title: "The Library · OVR",
};

export default function LibraryPage() {
  return <LibraryClient />;
}
