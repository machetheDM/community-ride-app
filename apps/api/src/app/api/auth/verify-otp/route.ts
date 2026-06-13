import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) return "+27" + digits.slice(1);
  if (digits.startsWith("27") && digits.length === 11) return "+" + digits;
  if (digits.startsWith("27") && digits.length === 12) return "+" + digits;
  return "+" + digits;
}

export async function POST(req: NextRequest) {
  try {
    const { phone, code } = await req.json();
    if (!phone || !code) return NextResponse.json({ error: "Phone and code required" }, { status: 400 });

    const normalized = normalizePhone(phone);
    const now = new Date();

    const otp = await prisma.otpCode.findFirst({
      where: { phone: normalized, code, used: false, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
    });

    if (!otp) return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 401 });

    await prisma.otpCode.update({ where: { id: otp.id }, data: { used: true } });

    let user = await prisma.user.findUnique({ where: { phone: normalized } });

    if (!user) {
      user = await prisma.user.create({
        data: { phone: normalized, name: "User", isVerified: true },
      });
    }

    const token = jwt.sign(
      { userId: user.id, phone: user.phone, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return NextResponse.json({
      token,
      user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar },
    });
  } catch {
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
