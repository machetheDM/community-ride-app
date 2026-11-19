import { prisma } from "@/lib/prisma";
import { sessionFor } from "@/lib/session";

/**
 * An event's poster for the admin's preview, drafts included. Admin only; anyone
 * else gets 404, so a draft's existence is not confirmed. The public page serves
 * published posters from the API.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await sessionFor("admin");
  if (!session) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;

  const event = await prisma.event.findUnique({ where: { id }, select: { posterBytes: true, posterType: true } });
  if (!event?.posterBytes || !event.posterType) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(event.posterBytes), {
    headers: {
      "Content-Type": event.posterType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
