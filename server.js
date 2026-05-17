// ============================================================
//  server.js — Tableau de Veille v4
// ============================================================
const express = require("express");
const cors    = require("cors");
const cron    = require("node-cron");
const { queries, getSetting, getAllSettings } = require("./db");
const { refreshAll } = require("./rss");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ── CSV export ───────────────────────────────────────────────
function toCSV(articles) {
  const headers = ["id","title","source","keyword","pub_date","link","relevance","favorite","read","tags","note"];
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...articles.map(a => headers.map(h => esc(a[h])).join(","))].join("\r\n");
}

// ── Boolean search parser ────────────────────────────────────
// Converts "IA AND France NOT Python" → SQL LIKE conditions
function parseBooleanSearch(raw) {
  if (!raw) return { sql: null, params: {} };
  // Simple: split on AND / NOT / OR and build LIKE chain
  // Returns a plain LIKE string for SQLite (full boolean left for future)
  const clean = raw.replace(/\s+(AND|OR|NOT)\s+/gi, " ").trim();
  return { plain: `%${clean}%` };
}

// ═══ Keywords ════════════════════════════════════════════════
app.get("/api/keywords", (req, res) => res.json(queries.getKeywords.all()));
app.post("/api/keywords", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
  queries.addKeyword.run(name.trim().toLowerCase());
  res.json({ ok: true });
});
app.delete("/api/keywords/:id", (req, res) => { queries.delKeyword.run(req.params.id); res.json({ ok: true }); });
app.put("/api/keywords/reorder", (req, res) => {
  const { order } = req.body; // [{id, position}]
  order.forEach(({ id, position }) => queries.reorderKw.run(position, id));
  res.json({ ok: true });
});

// ═══ Feeds ═══════════════════════════════════════════════════
app.get("/api/feeds", (req, res) => res.json(queries.getFeeds.all()));
app.post("/api/feeds", (req, res) => {
  const { name, url } = req.body;
  if (!name?.trim() || !url?.trim()) return res.status(400).json({ error: "Nom et URL requis" });
  try { res.json({ ok: true, id: queries.addFeed.run(name.trim(), url.trim()).lastInsertRowid }); }
  catch { res.status(409).json({ error: "URL déjà existante" }); }
});
app.put("/api/feeds/:id", (req, res) => {
  const { name, url, active } = req.body;
  queries.updateFeed.run(name, url, active ? 1 : 0, req.params.id);
  res.json({ ok: true });
});
app.delete("/api/feeds/:id", (req, res) => { queries.deleteFeed.run(req.params.id); res.json({ ok: true }); });

// ═══ Articles ════════════════════════════════════════════════
app.get("/api/articles/export", (req, res) => {
  let articles = queries.exportArticles.all();
  if (req.query.keyword) articles = articles.filter(a => a.keyword === req.query.keyword);
  if (req.query.source)  articles = articles.filter(a => a.source  === req.query.source);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="veille_${Date.now()}.csv"`);
  res.send("\uFEFF" + toCSV(articles));
});

app.get("/api/articles", (req, res) => {
  const {
    keyword=null, source=null, search=null, sort="date",
    fav="0", unread="0", minScore="0",
    dateFrom=null, dateTo=null, tag=null,
    limit="24", page="1"
  } = req.query;

  const lim    = Math.min(parseInt(limit)||24, 200);
  const offset = (Math.max(parseInt(page)||1,1)-1)*lim;
  const { plain } = parseBooleanSearch(search);
  const params = {
    keyword: keyword||null, source: source||null,
    search: plain||null,
    favOnly: fav==="1"?1:0, unread: unread==="1"?1:0,
    minScore: parseFloat(minScore)||0,
    dateFrom: dateFrom||null, dateTo: dateTo||null,
    tag: tag||null, tagSearch: tag ? `%${tag}%` : null,
    sort, limit: lim, offset,
  };

  res.json({
    total:    queries.countArticles.get(params).total,
    page:     parseInt(page),
    articles: queries.getArticles.all(params),
  });
});

app.get("/api/articles/tags", (req, res) => {
  const rows = queries.getAllTags.all();
  const tags = new Set();
  rows.forEach(r => r.tags.split(",").map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t)));
  res.json([...tags].sort());
});

app.post("/api/articles/:id/favorite", (req, res) => {
  queries.toggleFavorite.run(req.params.id);
  res.json({ favorite: queries.getArticleById.get(req.params.id).favorite });
});
app.post("/api/articles/:id/read", (req, res) => {
  queries.markRead.run(req.params.id);
  res.json({ ok: true });
});
app.post("/api/articles/read-all", (req, res) => {
  const { keyword } = req.body;
  if (keyword) queries.markAllRead.run(keyword);
  res.json({ ok: true });
});
app.put("/api/articles/:id/note", (req, res) => {
  queries.updateNote.run(req.body.note || "", req.params.id);
  res.json({ ok: true });
});
app.put("/api/articles/:id/tags", (req, res) => {
  queries.updateTags.run((req.body.tags || []).join(","), req.params.id);
  res.json({ ok: true });
});

// ═══ Collections ═════════════════════════════════════════════
app.get("/api/collections", (req, res) => res.json(queries.getCollections.all()));
app.post("/api/collections", (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Nom requis" });
  try { res.json({ ok: true, id: queries.addCollection.run(name.trim()).lastInsertRowid }); }
  catch { res.status(409).json({ error: "Nom déjà utilisé" }); }
});
app.delete("/api/collections/:id", (req, res) => { queries.deleteCollection.run(req.params.id); res.json({ ok: true }); });
app.get("/api/collections/:id/articles", (req, res) => res.json(queries.getCollectionArticles.all(req.params.id)));
app.post("/api/collections/:id/articles", (req, res) => {
  queries.addToCollection.run(req.params.id, req.body.article_id);
  res.json({ ok: true });
});
app.delete("/api/collections/:id/articles/:aid", (req, res) => {
  queries.removeFromCollection.run(req.params.id, req.params.aid);
  res.json({ ok: true });
});

// ═══ Analytics ════════════════════════════════════════════════
app.get("/api/analytics", (req, res) => {
  res.json({
    byDay:     queries.getStatsByDay.all(),
    bySource:  queries.getStatsBySource.all(),
    byKeyword: queries.getStatsByKeyword.all(),
    trending:  queries.getTrending.all(),
    fetchLog:  queries.getFetchLog.all(),
  });
});

// ═══ Settings ════════════════════════════════════════════════
app.get("/api/settings", (req, res) => res.json(getAllSettings()));
app.put("/api/settings", (req, res) => {
  ["refresh_interval","dedup_threshold"].forEach(k => {
    if (req.body[k] !== undefined) queries.setSetting.run(k, String(req.body[k]));
  });
  if (req.body.refresh_interval) scheduleCron();
  res.json({ ok: true });
});

// ═══ Refresh ══════════════════════════════════════════════════
app.post("/api/refresh", async (req, res) => {
  try { res.json({ ok: true, ...(await refreshAll()) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ CRON ════════════════════════════════════════════════════
let cronJob = null;
function scheduleCron() {
  const minutes = Math.max(parseInt(getSetting("refresh_interval")||"30"),1);
  if (cronJob) cronJob.stop();
  cronJob = cron.schedule(`*/${minutes} * * * *`, async () => {
    console.log(`[CRON] Refresh auto (/${minutes}min)`);
    await refreshAll();
  });
  console.log(`[CRON] Planifié toutes les ${minutes} min`);
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`\n✅  Veille Dashboard v4 — http://localhost:${PORT}\n`);
  scheduleCron();
  if (queries.getKeywords.all().length > 0) {
    console.log("[Init] Refresh initial...");
    await refreshAll();
  }
});
