import type { Metadata } from "next";
import { StudioClient } from "./StudioClient";

export const metadata: Metadata = {
  title: "Learning Studio · OVR",
  description:
    "Upload a PDF of your notes and get a short narrated lesson with visuals, knowledge checks and an AI teacher who answers from your notes.",
};

export default function LearningStudioPage() {
  return <StudioClient />;
}
