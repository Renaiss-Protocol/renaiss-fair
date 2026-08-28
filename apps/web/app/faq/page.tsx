import type { Metadata } from "next";
import { FaqContent } from "@/components/faq-content";

export const metadata: Metadata = {
  title: "FAQ — Renaiss Verify Your Rip",
  description:
    "Straight answers on provable fairness: can Renaiss pick your card, who controls entry, and how to verify any rip yourself.",
};

export default function FaqPage() {
  return <FaqContent />;
}
