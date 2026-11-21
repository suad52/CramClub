"use client";

import dynamic from "next/dynamic";

const LibraryModelTest = dynamic(() => import("@/components/dev/LibraryModelTest"), { ssr: false });

export function LibraryTestClient() {
  return <LibraryModelTest />;
}
