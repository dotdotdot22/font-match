export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats" && request.method === "GET") {
      return handleStats(env);
    }

    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env);
    }

    if (url.pathname === "/api/share" && request.method === "POST") {
      return handleCreateShare(request, env);
    }

    if (url.pathname.startsWith("/api/share/") && request.method === "GET") {
      const id = url.pathname.split("/").pop();
      return handleGetShare(id, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleStats(env) {
  const totalRow = await env.DB
    .prepare(`SELECT value FROM site_stats WHERE key = 'total_players'`)
    .first();

  const roundRows = await env.DB
    .prepare(`SELECT round_index, choice, count FROM round_counts`)
    .all();

  const categoryRows = await env.DB
    .prepare(`SELECT category, count FROM category_counts ORDER BY count DESC`)
    .all();

  return json({
    totalPlayers: totalRow ? totalRow.value : 0,
    rounds: roundRows.results || [],
    categories: categoryRows.results || []
  });
}

async function handleSubmit(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const picks = Array.isArray(body.picks) ? body.picks : null;
  const category = typeof body.category === "string" ? body.category : null;

  if (!picks || picks.length === 0 || !category) {
    return json({ error: "Missing picks or category" }, 400);
  }

  const statements = [];

  for (const p of picks) {
    if (
      typeof p.round !== "number" ||
      (p.choice !== "a" && p.choice !== "b")
    ) {
      continue;
    }

    statements.push(
      env.DB.prepare(
        `INSERT INTO round_counts (round_index, choice, count)
         VALUES (?, ?, 1)
         ON CONFLICT(round_index, choice)
         DO UPDATE SET count = count + 1`
      ).bind(p.round, p.choice)
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO category_counts (category, count)
       VALUES (?, 1)
       ON CONFLICT(category)
       DO UPDATE SET count = count + 1`
    ).bind(category)
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO site_stats (key, value)
       VALUES ('total_players', 1)
       ON CONFLICT(key)
       DO UPDATE SET value = value + 1`
    )
  );

  await env.DB.batch(statements);

  return json({ ok: true });
}

async function handleCreateShare(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!Array.isArray(body.answers)) {
    return json({ error: "Missing answers" }, 400);
  }

  const id = makeId();
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 24) : "";
  const answers = JSON.stringify(body.answers);
  const createdAt = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO shared_results (id, name, answers, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(id, name, answers, createdAt)
    .run();

  return json({ id });
}

async function handleGetShare(id, env) {
  if (!id) {
    return json({ error: "Missing id" }, 400);
  }

  const row = await env.DB
    .prepare(
      `SELECT id, name, answers
       FROM shared_results
       WHERE id = ?`
    )
    .bind(id)
    .first();

  if (!row) {
    return json({ error: "Not found" }, 404);
  }

  return json({
    id: row.id,
    name: row.name || "",
    answers: JSON.parse(row.answers)
  });
}

function makeId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";

  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }

  return id;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
