import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SHOW_TAMPER } from "@/lib/flags";
import { PageClientF } from "./page-client";

export default function VersionF() {
  if (!SHOW_TAMPER) notFound();
  return (
    <Suspense fallback={null}>
      <PageClientF />
    </Suspense>
  );
}
