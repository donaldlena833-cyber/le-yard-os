import type { Metadata } from "next";
import { KitchenWorkspace } from "@/components/kitchen/kitchen-workspace";

export const metadata: Metadata = { title: "Kitchen" };

export default function KitchenPage() {
  return <KitchenWorkspace />;
}
