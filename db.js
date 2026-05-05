// ============================================================
//  db.js — Base de données SQLite v4
// ============================================================
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "veille.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS keywords (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    position   INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS feeds (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    url        TEXT NOT NULL UNIQUE,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guid        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    excerpt     TEXT,
    link        TEXT,
    source      TEXT,
    pub_date    TEXT,
    keyword     TEXT,
    relevance   REAL DEFAULT 0,
    favorite    INTEGER NOT NULL DEFAULT 0,
    read        INTEGER NOT NULL DEFAULT 0,
    tags        TEXT DEFAULT '',
    note        TEXT DEFAULT '',
    cluster_id  INTEGER DEFAULT NULL,
    fetched_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collections (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS collection_articles (
    collection_id INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    article_id    INTEGER REFERENCES articles(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, article_id)
  );

  CREATE TABLE IF NOT EXISTS fetch_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    fetched_at TEXT DEFAULT (datetime('now')),
    inserted   INTEGER DEFAULT 0,
    feeds      INTEGER DEFAULT 0,
    keywords   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_kw      ON articles(keyword);
  CREATE INDEX IF NOT EXISTS idx_dt      ON articles(pub_date DESC);
  CREATE INDEX IF NOT EXISTS idx_fav     ON articles(favorite);
  CREATE INDEX IF NOT EXISTS idx_src     ON articles(source);
  CREATE INDEX IF NOT EXISTS idx_cluster ON articles(cluster_id);
`);

// Flux par défaut
const feedCount = db.prepare("SELECT COUNT(*) as c FROM feeds").get().c;
if (feedCount === 0) {
  const ins = db.prepare("INSERT OR IGNORE INTO feeds (name, url) VALUES (?, ?)");
  [
    ["Hacker News",       "https://news.ycombinator.com/rss"],
    ["TechCrunch",        "https://techcrunch.com/feed/"],
    ["The Verge",         "https://www.theverge.com/rss/index.xml"],
    ["Dev.to",            "https://dev.to/feed"],
    ["CSS-Tricks",        "https://css-tricks.com/feed/"],
    ["Smashing Magazine", "https://www.smashingmagazine.com/feed/"],
    ["MIT Tech Review",   "https://www.technologyreview.com/feed/"],
    ["VentureBeat AI",    "https://venturebeat.com/category/ai/feed/"],
    ["Krebs on Security", "https://krebsonsecurity.com/feed/"],
    ["Le Monde Pixel",    "https://www.lemonde.fr/pixels/rss_full.xml"],
    ["Numerama",          "https://www.numerama.com/feed/"],
    ["Wired",             "https://www.wired.com/feed/rss"],
  ].forEach(([n, u]) => ins.run(n, u));
}

const setDefault = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
setDefault.run("refresh_interval", "30");
setDefault.run("dedup_threshold",  "0.75");

const q = {
  getSetting:    db.prepare("SELECT value FROM settings WHERE key = ?"),
  setSetting:    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"),
  getAllSettings: db.prepare("SELECT key, value FROM settings"),

  getKeywords:   db.prepare("SELECT * FROM keywords ORDER BY position, created_at DESC"),
  addKeyword:    db.prepare("INSERT OR IGNORE INTO keywords (name) VALUES (?)"),
  delKeyword:    db.prepare("DELETE FROM keywords WHERE id = ?"),
  reorderKw:     db.prepare("UPDATE keywords SET position = ? WHERE id = ?"),

  getFeeds:       db.prepare("SELECT * FROM feeds ORDER BY name"),
  getActiveFeeds: db.prepare("SELECT * FROM feeds WHERE active = 1"),
  addFeed:        db.prepare("INSERT INTO feeds (name, url) VALUES (?, ?)"),
  updateFeed:     db.prepare("UPDATE feeds SET name=?, url=?, active=? WHERE id=?"),
  deleteFeed:     db.prepare("DELETE FROM feeds WHERE id=?"),

  upsertArticle: db.prepare(`
    INSERT OR IGNORE INTO articles (guid, title, excerpt, link, source, pub_date, keyword, relevance)
    VALUES (@guid, @title, @excerpt, @link, @source, @pub_date, @keyword, @relevance)
  `),
  getArticles: db.prepare(`
    SELECT * FROM articles
    WHERE (:keyword IS NULL OR keyword = :keyword)
      AND (:source  IS NULL OR source  = :source)
      AND (:search  IS NULL OR title LIKE :search OR excerpt LIKE :search)
      AND (:favOnly  = 0 OR favorite = 1)
      AND (:unread   = 0 OR read = 0)
      AND (:minScore = 0 OR relevance >= :minScore)
      AND (:dateFrom IS NULL OR pub_date >= :dateFrom)
      AND (:dateTo   IS NULL OR pub_date <= :dateTo)
      AND (:tag IS NULL OR tags LIKE :tagSearch)
    ORDER BY
      CASE :sort
        WHEN 'relevance' THEN relevance * -1
        WHEN 'source'    THEN source
        ELSE pub_date
      END DESC
    LIMIT :limit OFFSET :offset
  `),
  countArticles: db.prepare(`
    SELECT COUNT(*) as total FROM articles
    WHERE (:keyword IS NULL OR keyword = :keyword)
      AND (:source  IS NULL OR source  = :source)
      AND (:search  IS NULL OR title LIKE :search OR excerpt LIKE :search)
      AND (:favOnly  = 0 OR favorite = 1)
      AND (:unread   = 0 OR read = 0)
      AND (:minScore = 0 OR relevance >= :minScore)
      AND (:dateFrom IS NULL OR pub_date >= :dateFrom)
      AND (:dateTo   IS NULL OR pub_date <= :dateTo)
      AND (:tag IS NULL OR tags LIKE :tagSearch)
  `),
  getArticleById:  db.prepare("SELECT * FROM articles WHERE id = ?"),
  toggleFavorite:  db.prepare("UPDATE articles SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END WHERE id = ?"),
  markRead:        db.prepare("UPDATE articles SET read = 1 WHERE id = ?"),
  markAllRead:     db.prepare("UPDATE articles SET read = 1 WHERE keyword = ?"),
  updateNote:      db.prepare("UPDATE articles SET note = ? WHERE id = ?"),
  updateTags:      db.prepare("UPDATE articles SET tags = ? WHERE id = ?"),
  setCluster:      db.prepare("UPDATE articles SET cluster_id = ? WHERE id = ?"),
  exportArticles:  db.prepare("SELECT * FROM articles ORDER BY pub_date DESC"),
  getAllTags:       db.prepare("SELECT DISTINCT tags FROM articles WHERE tags != ''"),

  // Trending: articles des dernières 24h vs moyenne 7j
  getTrending: db.prepare(`
    SELECT keyword,
      COUNT(CASE WHEN fetched_at >= datetime('now','-1 day') THEN 1 END) as recent,
      COUNT(*) as total
    FROM articles
    WHERE fetched_at >= datetime('now','-7 days')
    GROUP BY keyword
  `),

  // Stats par jour (30 derniers jours)
  getStatsByDay: db.prepare(`
    SELECT DATE(pub_date) as day, keyword, COUNT(*) as count
    FROM articles
    WHERE pub_date >= datetime('now','-30 days')
    GROUP BY day, keyword
    ORDER BY day
  `),
  getStatsBySource: db.prepare(`
    SELECT source, COUNT(*) as count, AVG(relevance) as avg_rel
    FROM articles GROUP BY source ORDER BY count DESC LIMIT 20
  `),
  getStatsByKeyword: db.prepare(`
    SELECT keyword, COUNT(*) as count, AVG(relevance) as avg_rel,
           SUM(favorite) as favs, SUM(read) as reads
    FROM articles GROUP BY keyword ORDER BY count DESC
  `),

  // Fetch log
  logFetch: db.prepare("INSERT INTO fetch_log (inserted, feeds, keywords) VALUES (?, ?, ?)"),
  getFetchLog: db.prepare("SELECT * FROM fetch_log ORDER BY fetched_at DESC LIMIT 20"),

  // Collections
  getCollections:        db.prepare("SELECT c.*, COUNT(ca.article_id) as count FROM collections c LEFT JOIN collection_articles ca ON ca.collection_id = c.id GROUP BY c.id ORDER BY c.name"),
  addCollection:         db.prepare("INSERT INTO collections (name) VALUES (?)"),
  deleteCollection:      db.prepare("DELETE FROM collections WHERE id = ?"),
  addToCollection:       db.prepare("INSERT OR IGNORE INTO collection_articles VALUES (?,?)"),
  removeFromCollection:  db.prepare("DELETE FROM collection_articles WHERE collection_id=? AND article_id=?"),
  getCollectionArticles: db.prepare("SELECT a.* FROM articles a JOIN collection_articles ca ON ca.article_id = a.id WHERE ca.collection_id = ? ORDER BY a.pub_date DESC"),

  // Duplicate detection
  getRecentForDedup: db.prepare("SELECT id, title, keyword FROM articles WHERE fetched_at >= datetime('now','-3 days') ORDER BY pub_date DESC"),
};

function getSetting(key) { const r = q.getSetting.get(key); return r ? r.value : null; }
function getAllSettings() { return Object.fromEntries(q.getAllSettings.all().map(r => [r.key, r.value])); }

module.exports = { db, queries: q, getSetting, getAllSettings };
