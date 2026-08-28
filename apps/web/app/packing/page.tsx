import { Suspense } from "react";
import { TasksPageClient } from "./page-client";

export default function TasksPage() {
  return (
    <Suspense fallback={null}>
      <TasksPageClient />
    </Suspense>
  );
}
