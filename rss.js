// ============================================================
//  rss.js — Fetch RSS + score pertinence + dédup sémantique
// ============================================================
const Parser = require("rss-parser");
const { queries, getSetting } = require("./db");

const parser = new Parser({ timeout: 8000 });

function relevanceScore(excerpt, title, keyword) {
  const kw = keyword.toLowerCase();
  const inTitle   = (title   || "").toLowerCase().split(/\s+/).filter(w => w.includes(kw)).length;
  const inExcerpt = (excerpt || "").toLowerCase().split(/\s+/).filter(w => w.includes(kw)).length;
  return Math.min((inTitle * 3 + inExcerpt) / 10, 1);
}

function stripHtml(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

// Similarité cosinus simplifiée sur les mots
function similarity(a, b) {
  const wordsOf = s => new Set((s || "").toLowerCase().replace(/[^a-zàéèêëîïôùûüç\s]/g, " ").split(/\s+/).filter(w => w.length > 3));
  const wa = wordsOf(a), wb = wordsOf(b);
  const inter = [...wa].filter(w => wb.has(w)).length;
  return inter / (Math.sqrt(wa.size) * Math.sqrt(wb.size) || 1);
}

function clusterArticles() {
  const threshold = parseFloat(getSetting("dedup_threshold") || "0.75");
  const articles  = queries.getRecentForDedup.all();
  let clusterIdCounter = Date.now();

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      if (articles[i].keyword !== articles[j].keyword) continue;
      const sim = similarity(articles[i].title, articles[j].title);
      if (sim >= threshold) {
        const cid = articles[i].cluster_id || articles[j].cluster_id || (clusterIdCounter++);
        queries.setCluster.run(cid, articles[i].id);
        queries.setCluster.run(cid, articles[j].id);
        articles[i].cluster_id = cid;
        articles[j].cluster_id = cid;
      }
    }
  }
}

async function fetchFeed(feed) {
  try {
    const result = await parser.parseURL(feed.url);
    return result.items.map(item => ({
      guid:     item.guid || item.link || `${feed.url}-${item.title}`,
      title:    (item.title || "").trim(),
      excerpt:  stripHtml(item.contentSnippet || item.content || ""),
      link:     item.link || "",
      source:   feed.name,
      pub_date: item.isoDate || item.pubDate || new Date().toISOString(),
    }));
  } catch (err) {
    console.error(`[RSS] ✗ ${feed.name}: ${err.message}`);
    return [];
  }
}

async function refreshAll() {
  const feeds    = queries.getActiveFeeds.all();
  const keywords = queries.getKeywords.all().map(k => k.name);
  if (keywords.length === 0) return { inserted: 0, feeds: feeds.length, keywords: 0 };

  console.log(`[RSS] Refresh — ${feeds.length} flux × ${keywords.length} mots-clés`);
  const results  = await Promise.allSettled(feeds.map(fetchFeed));
  const allItems = results.flatMap(r => r.status === "fulfilled" ? r.value : []);

  let inserted = 0;
  for (const kw of keywords) {
    const matched = allItems.filter(item =>
      item.title.toLowerCase().includes(kw) || item.excerpt.toLowerCase().includes(kw)
    );
    for (const item of matched) {
      const info = queries.upsertArticle.run({ ...item, keyword: kw, relevance: relevanceScore(item.excerpt, item.title, kw) });
      if (info.changes > 0) inserted++;
    }
  }

  clusterArticles();
  queries.logFetch.run(inserted, feeds.length, keywords.length);
  console.log(`[RSS] ✓ ${inserted} nouveaux articles`);
  return { inserted, feeds: feeds.length, keywords: keywords.length };
}

module.exports = { refreshAll };
