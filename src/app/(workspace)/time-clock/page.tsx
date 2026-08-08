import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Vendors" };

export default function TimeClockPage() {
  redirect("/vendors");
}
