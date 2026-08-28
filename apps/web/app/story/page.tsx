import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SHOW_STORY } from "@/lib/flags";
import { PageClientE } from "./page-client";

export default function VersionE() {
  if (!SHOW_STORY) notFound();
  return (
    <Suspense fallback={null}>
      <PageClientE />
    </Suspense>
  );
}
