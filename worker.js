// quizheart API worker.
//
// Two quizzes share these tables. Every stored key is namespaced with the
// quiz it came from ("fonts:Playfair Display", "scent:Vanilla") so the two
// can never be mixed again. Anything that arrives without a recognised quiz
// name is rejected rather than written to a default, because a silent default
// is how the tables got mixed in the first place.
const QUIZZES = ["fonts", "scent"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/stats" && request.method === "GET") {
      return handleStats(url, env);
    }
    if (url.pathname === "/api/submit" && request.method === "POST") {
      return handleSubmit(request, env);
    }
    if (url.pathname === "/api/share" && request.method === "POST") {
      return handleCreateShare(request, env);
    }
    if (url.pathname.startsWith("/api/share/") && request.method === "GET") {
      return handleGetShare(url.pathname.split("/").pop(), env);
    }

    return env.ASSETS.fetch(request);
  }
};

function quizOf(value) {
  return QUIZZES.indexOf(value) !== -1 ? value : null;
}

async function handleStats(url, env) {
  const quiz = quizOf(url.searchParams.get("quiz"));
  if (!quiz) {
    return json({ error: "Unknown or missing quiz" }, 400);
  }
  const prefix = quiz + ":";
  const like = prefix + "%";

  const totalRow = await env.DB
    .prepare(`SELECT value FROM site_stats WHERE key = ?`)
    .bind("total_players_" + quiz)
    .first();

  const fontRows = await env.DB
    .prepare(`SELECT font_key, wins, losses, champion_count
              FROM font_battle_stats WHERE font_key LIKE ?`)
    .bind(like)
    .all();

  const categoryRows = await env.DB
    .prepare(`SELECT category, count FROM category_counts
              WHERE category LIKE ? ORDER BY count DESC`)
    .bind(like)
    .all();

  // The prefix is storage plumbing — strip it before it reaches the page.
  const strip = s => s.slice(prefix.length);

  return json({
    quiz,
    totalPlayers: totalRow ? totalRow.value : 0,
    fonts: (fontRows.results || []).map(r => ({ ...r, font_key: strip(r.font_key) })),
    categories: (categoryRows.results || []).map(r => ({ ...r, category: strip(r.category) })),
  });
}

async function handleSubmit(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const quiz = quizOf(body.quiz);
  if (!quiz) {
    return json({ error: "Unknown or missing quiz" }, 400);
  }
  const prefix = quiz + ":";

  const items = Array.isArray(body.fonts) ? body.fonts : null;
  const championKey = typeof body.championKey === "string" ? body.championKey : null;
  const category = typeof body.category === "string" ? body.category : null;

  if (!items || items.length === 0 || !championKey || !category) {
    return json({ error: "Missing fonts, championKey, or category" }, 400);
  }

  const statements = [];

  for (const f of items) {
    if (typeof f.key !== "string" || typeof f.wins !== "number") continue;
    const isChampion = f.key === championKey;
    // Losses are counted properly now rather than assumed to be one.
    const losses = typeof f.losses === "number" ? f.losses : (isChampion ? 0 : 1);

    statements.push(
      env.DB.prepare(
        `INSERT INTO font_battle_stats (font_key, wins, losses, champion_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(font_key) DO UPDATE SET
           wins = wins + excluded.wins,
           losses = losses + excluded.losses,
           champion_count = champion_count + excluded.champion_count`
      ).bind(prefix + f.key, f.wins, losses, isChampion ? 1 : 0)
    );
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO category_counts (category, count) VALUES (?, 1)
       ON CONFLICT(category) DO UPDATE SET count = count + 1`
    ).bind(prefix + category)
  );

  statements.push(
    env.DB.prepare(
      `INSERT INTO site_stats (key, value) VALUES (?, 1)
       ON CONFLICT(key) DO UPDATE SET value = value + 1`
    ).bind("total_players_" + quiz)
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
    .prepare(`INSERT INTO shared_results (id, name, answers, created_at) VALUES (?, ?, ?, ?)`)
    .bind(id, name, answers, createdAt)
    .run();

  return json({ id });
}

async function handleGetShare(id, env) {
  if (!id) return json({ error: "Missing id" }, 400);

  const row = await env.DB
    .prepare(`SELECT id, name, answers FROM shared_results WHERE id = ?`)
    .bind(id)
    .first();

  if (!row) return json({ error: "Not found" }, 404);

  return json({ id: row.id, name: row.name || "", answers: JSON.parse(row.answers) });
}

function makeId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}
