import { redirect } from "next/navigation";
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  const { connection } = await searchParams;
  const query = connection && ["linked", "declined", "failed"].includes(connection) ? `?connection=${connection}` : "";
  redirect(`/today${query}#music`);
}
