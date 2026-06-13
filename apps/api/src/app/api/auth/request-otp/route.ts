import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return "+27" + digits.slice(1);
  if (digits.startsWith("27") && digits.length === 11) return "+" + digits;
  if (digits.startsWith("27") && digits.length === 12) return "+" + digits;
  return "+" + digits;
}

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) return NextResponse.json({ error: "Phone number required" }, { status: 400 });

    const normalized = normalizePhone(phone);
    if (normalized.length < 10)
      return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });

    const code = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otpCode.create({ data: { phone: normalized, code, expiresAt } });

    console.log(`[OTP] ${normalized} → ${code}`);

    return NextResponse.json({
      success: true,
      message: "OTP sent",
      ...(process.env.NODE_ENV === "development" ? { code } : {}),
    });
  } catch {
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
