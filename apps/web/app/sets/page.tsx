import { Suspense } from "react";
import { PageClientB } from "./page-client";

export default function VersionB() {
  return (
    <Suspense fallback={null}>
      <PageClientB />
    </Suspense>
  );
}
