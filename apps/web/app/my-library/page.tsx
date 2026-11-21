import type { Metadata } from "next";
import { MyLibrary } from "@/components/my-library/MyLibrary";
import { parseTab } from "@/components/my-library/tabs";

export const metadata: Metadata = {
  title: "My library · OVR",
  description:
    "Your private library: the sources, lessons, study plans and notes you've saved, kept with your account.",
};

/**
 * A signed-in student's private library. Everything on it comes from /api/me/*, which checks the
 * Auth0 session on the server; this page only decides what to show while signed out or while
 * sign-in isn't set up.
 */
export default async function MyLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { tab } = await searchParams;
  return <MyLibrary initialTab={parseTab(tab)} />;
}
