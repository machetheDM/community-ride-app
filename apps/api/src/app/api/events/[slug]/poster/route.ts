import { prisma } from "@/lib/prisma";

/**
 * A published event's poster, already stripped of its metadata when it was
 * uploaded. This is the image Facebook and WhatsApp put in the link preview.
 * Cached for a day: a published poster cannot change (event-actions.ts).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const event = await prisma.event.findUnique({
    where: { slug },
    select: { status: true, posterBytes: true, posterType: true, posterSha256: true },
  });
  if (!event || event.status !== "PUBLISHED" || !event.posterBytes || !event.posterType) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(event.posterBytes), {
    headers: {
      "Content-Type": event.posterType,
      "Cache-Control": "public, max-age=86400",
      ETag: `"${event.posterSha256}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
