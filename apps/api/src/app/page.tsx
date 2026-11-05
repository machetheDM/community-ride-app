/**
 * The API's front door: a name and nothing else.
 *
 * This used to redirect to `/admin`, a dashboard with no sign-in that showed
 * platform counts and recent customers' names and phone numbers to anyone
 * (PLAN.md section 2, hole 9; threat model PA-5). The middleware guards `/api`
 * only, so the page was never covered. It is gone; administration lives in the
 * merchant portal behind the ADMIN role. Nothing here reads the database, so
 * there is nothing here to leak.
 */
export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Community Ride API</h1>
        <p className="text-slate-400 text-sm mt-2">This service answers the Community Ride apps.</p>
      </div>
    </main>
  );
}
