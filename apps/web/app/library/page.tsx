import { redirect } from "next/navigation";

/** The library is the home page now; old /library links land there. */
export default function LibraryPage() {
  redirect("/");
}
