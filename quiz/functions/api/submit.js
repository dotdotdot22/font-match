// POST /api/submit
// Records one completed quiz as anonymous tallies only — no name, no
// individual answer set is ever stored. Three things get incremented:
//   1. round_counts   — how many people picked "a" vs "b" in each round
//   2. category_counts — how many people landed on each type personality
//   3. site_stats.total_players — a running count of completed quizzes
//
// Expects a D1 database bound to this Pages project as "DB"
// (Pages dashboard → your project → Settings → Functions → D1 bindings).

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const picks = Array.isArray(body.picks) ? body.picks : null;
  const category = typeof body.category === "string" ? body.category : null;

  if (!picks || picks.length === 0 || !category) {
    return new Response(JSON.stringify({ error: "Missing picks or category" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const db = env.DB;
  if (!db) {
    return new Response(JSON.stringify({ error: "No DB binding configured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const statements = [];

  for (const p of picks) {
    if (typeof p.round !== "number" || (p.choice !== "a" && p.choice !== "b")) continue;
    statements.push(
      db.prepare(
        `INSERT INTO round_counts (round_index, choice, count)
         VALUES (?, ?, 1)
         ON CONFLICT(round_index, choice) DO UPDATE SET count = count + 1`
      ).bind(p.round, p.choice)
    );
  }

  statements.push(
    db.prepare(
      `INSERT INTO category_counts (category, count)
       VALUES (?, 1)
       ON CONFLICT(category) DO UPDATE SET count = count + 1`
    ).bind(category)
  );

  statements.push(
    db.prepare(
      `INSERT INTO site_stats (key, value)
       VALUES ('total_players', 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1`
    )
  );

  try {
    await db.batch(statements);
  } catch (e) {
    return new Response(JSON.stringify({ error: "Database write failed" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
