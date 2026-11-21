import { redirect } from "next/navigation";
import { demoFlagFrom } from "@/lib/demo/settings";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The library is the home page now; old /library links land there. /library?demo=1 opens the
 * judge demo (/demo), and ?demo=0 turns it off on the way home.
 */
export default async function LibraryPage({ searchParams }: Props) {
  const demo = (await searchParams).demo;
  const flag =
    typeof demo === "string" ? demoFlagFrom(new URLSearchParams({ demo }).toString()) : null;
  redirect(flag === true ? "/demo" : flag === false ? "/?demo=0" : "/");
}
