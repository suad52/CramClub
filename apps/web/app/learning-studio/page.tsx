import type { Metadata } from "next";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = { title: "AI Learning Studio · OVR" };

export default function LearningStudioPage() {
  return <StudioClient />;
}
