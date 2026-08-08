// GET /api/stats
// Returns only aggregate numbers — total player count, per-round tallies,
// and type-personality tallies. No individual quiz result is ever returned
// or stored, because none is ever saved in the first place.

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.DB;

  if (!db) {
    return new Response(JSON.stringify({ error: "No DB binding configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const totalRow = await db
    .prepare(`SELECT value FROM site_stats WHERE key = 'total_players'`)
    .first();
  const totalPlayers = totalRow ? totalRow.value : 0;

  const roundRows = await db
    .prepare(`SELECT round_index, choice, count FROM round_counts`)
    .all();

  const categoryRows = await db
    .prepare(`SELECT category, count FROM category_counts ORDER BY count DESC`)
    .all();

  return new Response(
    JSON.stringify({
      totalPlayers,
      rounds: roundRows.results || [],
      categories: categoryRows.results || [],
    }),
    { headers: { "content-type": "application/json" } }
  );
}
