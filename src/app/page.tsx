import { redirect } from "next/navigation";
import { defaultWorkspacePath } from "@/lib/app-surface";

export default function Home() {
  redirect(defaultWorkspacePath);
}
