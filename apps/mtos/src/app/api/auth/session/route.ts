import { NextResponse } from "next/server";

export async function POST(request: Request) {
  await request.json().catch(() => null);
  return NextResponse.json(
    { error: "Deprecated. Use /api/auth/firebase-session." },
    { status: 410 },
  );
}
