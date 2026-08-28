import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SHOW_FLOW } from "@/lib/flags";
import { PageClientD } from "./page-client";

export default function VersionD() {
  if (!SHOW_FLOW) notFound();
  return (
    <Suspense fallback={null}>
      <PageClientD />
    </Suspense>
  );
}
