import { redirect } from "next/navigation";

export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const nextPath = searchParams?.next;
  const target = nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in";
  redirect(target);
}
