'use strict';
/**
 * Ordered schema migrations. NEVER edit a released migration — append a new
 * function instead. Index i migrates user_version i -> i+1.
 */
module.exports = [
  // v1 — initial schema of JARVIS 3
  (db) => db.exec(`
    CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE conversations(
      id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT 'Neues Gespräch',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE messages(
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user','assistant','tool','system')),
      content TEXT NOT NULL DEFAULT '',
      meta TEXT NOT NULL DEFAULT '{}',
      channel TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL);
    CREATE INDEX ix_messages_conv ON messages(conversation_id, created_at);
    CREATE VIRTUAL TABLE messages_fts USING fts5(content, content='messages', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content); END;
    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content); END;
    CREATE TRIGGER messages_au AFTER UPDATE OF content ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content); END;

    CREATE TABLE tasks(
      id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Allgemein',
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
      due_at TEXT, all_day INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT, reminder_minutes INTEGER,
      parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','done')),
      completed_at TEXT, starred INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'user',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ix_tasks_due ON tasks(status, due_at);
    CREATE INDEX ix_tasks_parent ON tasks(parent_id);
    CREATE TABLE task_history(
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
    CREATE INDEX ix_task_history ON task_history(task_id, at);
    CREATE TABLE task_attachments(
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK(kind IN ('file','link')), name TEXT NOT NULL, ref TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE reminder_log(key TEXT PRIMARY KEY, at TEXT NOT NULL);

    CREATE TABLE calendars(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
      selected INTEGER NOT NULL DEFAULT 0, writable INTEGER NOT NULL DEFAULT 1,
      sync_token TEXT, synced_at TEXT);
    CREATE TABLE events(
      id TEXT PRIMARY KEY, calendar_id TEXT NOT NULL, google_id TEXT, etag TEXT,
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', location TEXT NOT NULL DEFAULT '',
      start_at TEXT NOT NULL, end_at TEXT NOT NULL, all_day INTEGER NOT NULL DEFAULT 0, time_zone TEXT,
      rrule TEXT, recurring_event_id TEXT, status TEXT NOT NULL DEFAULT 'confirmed',
      sync_state TEXT NOT NULL DEFAULT 'synced' CHECK(sync_state IN ('synced','pending_create','pending_update','pending_delete','conflict','local')),
      remote_updated TEXT, local_updated TEXT NOT NULL, conflict_data TEXT,
      UNIQUE(calendar_id, google_id));
    CREATE INDEX ix_events_time ON events(start_at, end_at);

    CREATE TABLE knowledge(
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'fact',
      domain TEXT NOT NULL DEFAULT 'knowledge',
      title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL DEFAULT 'user',
      source_ref TEXT, source_url TEXT,
      confidence REAL NOT NULL DEFAULT 0.8,
      sensitive INTEGER NOT NULL DEFAULT 0,
      subject_key TEXT, game TEXT, game_version TEXT,
      valid_until TEXT, archived INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0,
      conflict_with TEXT, merged_into TEXT,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ix_knowledge_domain ON knowledge(domain, archived);
    CREATE INDEX ix_knowledge_hash ON knowledge(content_hash);
    CREATE INDEX ix_knowledge_subject ON knowledge(subject_key);
    CREATE INDEX ix_knowledge_game ON knowledge(game);
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(title, content, tags, content='knowledge', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER knowledge_ai AFTER INSERT ON knowledge BEGIN INSERT INTO knowledge_fts(rowid,title,content,tags) VALUES (new.rowid,new.title,new.content,new.tags); END;
    CREATE TRIGGER knowledge_ad AFTER DELETE ON knowledge BEGIN INSERT INTO knowledge_fts(knowledge_fts,rowid,title,content,tags) VALUES('delete',old.rowid,old.title,old.content,old.tags); END;
    CREATE TRIGGER knowledge_au AFTER UPDATE OF title, content, tags ON knowledge BEGIN
      INSERT INTO knowledge_fts(knowledge_fts,rowid,title,content,tags) VALUES('delete',old.rowid,old.title,old.content,old.tags);
      INSERT INTO knowledge_fts(rowid,title,content,tags) VALUES (new.rowid,new.title,new.content,new.tags); END;
    CREATE TABLE knowledge_links(a TEXT NOT NULL, b TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'related', weight REAL NOT NULL DEFAULT 1, PRIMARY KEY(a,b,kind));
    CREATE INDEX ix_links_b ON knowledge_links(b);
    CREATE TABLE knowledge_revisions(id INTEGER PRIMARY KEY AUTOINCREMENT, knowledge_id TEXT NOT NULL, title TEXT, content TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL);

    CREATE TABLE documents(
      id TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'folder',
      path TEXT, rel_path TEXT NOT NULL, url TEXT, title TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT 'Allgemein', ext TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0, mtime_ms INTEGER NOT NULL DEFAULT 0,
      content_hash TEXT, page_count INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending', error TEXT, indexed_at TEXT, created_at TEXT NOT NULL,
      UNIQUE(path));
    CREATE INDEX ix_documents_hash ON documents(content_hash);
    CREATE TABLE chunks(
      id INTEGER PRIMARY KEY AUTOINCREMENT, doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      page INTEGER, ord INTEGER NOT NULL, text TEXT NOT NULL, hash TEXT NOT NULL, origin TEXT NOT NULL DEFAULT 'text');
    CREATE INDEX ix_chunks_doc ON chunks(doc_id, page);
    CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN INSERT INTO chunks_fts(rowid,text) VALUES(new.id,new.text); END;
    CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN INSERT INTO chunks_fts(chunks_fts,rowid,text) VALUES('delete',old.id,old.text); END;
    CREATE TABLE doc_pages(doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page INTEGER NOT NULL,
      checksum TEXT NOT NULL, text_len INTEGER NOT NULL DEFAULT 0, needs_vision INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(doc_id, page));
    CREATE TABLE page_analysis(checksum TEXT PRIMARY KEY, text TEXT NOT NULL, model TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE doc_versions(doc_id TEXT NOT NULL, version INTEGER NOT NULL, content_hash TEXT NOT NULL, fetched_at TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(doc_id, version));

    CREATE TABLE embeddings(
      owner TEXT NOT NULL, owner_id TEXT NOT NULL, model TEXT NOT NULL, dim INTEGER NOT NULL,
      text_hash TEXT NOT NULL, vec BLOB NOT NULL, PRIMARY KEY(owner, owner_id));

    CREATE TABLE notifications(
      id TEXT PRIMARY KEY, category TEXT NOT NULL DEFAULT 'system', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL DEFAULT 'system', game TEXT, dedupe_key TEXT UNIQUE,
      created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX ix_notifications ON notifications(read, created_at);

    CREATE TABLE game_state(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE game_timers(
      id TEXT PRIMARY KEY, game TEXT NOT NULL, label TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'custom',
      ends_at TEXT NOT NULL, created_at TEXT NOT NULL, fired INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '');
    CREATE INDEX ix_timers ON game_timers(fired, ends_at);
    CREATE TABLE game_maps(id TEXT PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL, image_file TEXT,
      width INTEGER, height INTEGER, created_at TEXT NOT NULL, UNIQUE(game, name));
    CREATE TABLE game_markers(
      id TEXT PRIMARY KEY, game TEXT NOT NULL, map TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'custom', label TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ix_markers ON game_markers(game, map);
    CREATE TABLE game_routes(id TEXT PRIMARY KEY, game TEXT NOT NULL, map TEXT NOT NULL, name TEXT NOT NULL,
      points TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE game_cache(key TEXT PRIMARY KEY, value TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL);
    CREATE TABLE lol_matches(match_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, played_at TEXT NOT NULL, summary TEXT NOT NULL);
    CREATE TABLE lol_samples(id INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, at TEXT NOT NULL,
      game_seconds REAL, champion TEXT, level INTEGER, gold REAL, k INTEGER, d INTEGER, a INTEGER, cs INTEGER);
    CREATE TABLE lol_goals(id TEXT PRIMARY KEY, text TEXT NOT NULL, metric TEXT, target REAL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);

    CREATE TABLE research(id TEXT PRIMARY KEY, query TEXT NOT NULL, answer TEXT NOT NULL, sources TEXT NOT NULL DEFAULT '[]', game TEXT, created_at TEXT NOT NULL);
    CREATE TABLE briefings(day TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE jobs(id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', run_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at TEXT NOT NULL, dedupe_key TEXT UNIQUE);
    CREATE INDEX ix_jobs ON jobs(status, run_at);
    CREATE TABLE imports(fingerprint TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL);
  `),
  // v2 — persönlicher Spielstand je Spiel
  (db) => db.exec(`
    CREATE TABLE game_progress(
      id TEXT PRIMARY KEY, game TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL,
      value TEXT NOT NULL DEFAULT '', status TEXT, note TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'chat',
      archived INTEGER NOT NULL DEFAULT 0, season TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ix_game_progress ON game_progress(game, archived, category, key);
    CREATE TABLE game_progress_history(id INTEGER PRIMARY KEY AUTOINCREMENT, progress_id TEXT NOT NULL, value TEXT, status TEXT, at TEXT NOT NULL);
    CREATE INDEX ix_game_progress_hist ON game_progress_history(progress_id);
  `),
  // v3 — Klausuren, Stundenplan-Abos, Spiel-Nachbesprechungen, Telegram
  (db) => db.exec(`
    CREATE TABLE exams(
      id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
      target_hours REAL NOT NULL DEFAULT 10, session_minutes INTEGER NOT NULL DEFAULT 90, notes TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE exam_sessions(
      id TEXT PRIMARY KEY, exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      start_at TEXT NOT NULL, end_at TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', event_id TEXT,
      status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','done','missed','skipped')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ix_exam_sessions ON exam_sessions(exam_id, start_at);
    CREATE TABLE calendar_feeds(
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, kind TEXT NOT NULL DEFAULT 'url', color TEXT NOT NULL DEFAULT '#a78bfa',
      lecture INTEGER NOT NULL DEFAULT 1, etag TEXT, content_hash TEXT, last_fetch TEXT, last_error TEXT, created_at TEXT NOT NULL);
    CREATE TABLE game_reviews(
      id TEXT PRIMARY KEY, game TEXT NOT NULL, ref TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      tips TEXT NOT NULL DEFAULT '[]', source TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(game, ref));
    CREATE TABLE screenshots(id TEXT PRIMARY KEY, file TEXT NOT NULL, question TEXT NOT NULL DEFAULT '', answer TEXT NOT NULL DEFAULT '', game TEXT, created_at TEXT NOT NULL);
  `),
  // v4 — Terminfarben (Google colorId) und Termintyp (z. B. Geburtstag)
  (db) => db.exec(`
    ALTER TABLE events ADD COLUMN color TEXT;
    ALTER TABLE events ADD COLUMN event_type TEXT;
  `),
  // v5 — Spielzeit-Sessions (alle Spiele, aus der Prozesserkennung) und Patch-Notes
  (db) => db.exec(`
    CREATE TABLE game_sessions(id TEXT PRIMARY KEY, game TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT, last_seen TEXT NOT NULL);
    CREATE INDEX ix_game_sessions ON game_sessions(game, start_at);
    CREATE TABLE game_news(id TEXT PRIMARY KEY, game TEXT NOT NULL, title TEXT NOT NULL, url TEXT, published_at TEXT NOT NULL, is_patch INTEGER NOT NULL DEFAULT 0,
      body TEXT NOT NULL DEFAULT '', summary TEXT, source TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX ix_game_news ON game_news(game, published_at);
  `),
  // v6 — wiederkehrende Spiel-Timer (Prägung alle 8 h, wöchentliche Events)
  (db) => db.exec(`
    ALTER TABLE game_timers ADD COLUMN repeat_min INTEGER;
    ALTER TABLE game_timers ADD COLUMN until TEXT;
    ALTER TABLE game_timers ADD COLUMN series TEXT;
  `),
  // v7 — Alltag: Ausgaben, Abos, Einkauf, Vorräte, Training, Abgaben
  (db) => db.exec(`
    CREATE TABLE expenses(id TEXT PRIMARY KEY, amount REAL NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX ix_expenses ON expenses(at);
    CREATE TABLE subscriptions(id TEXT PRIMARY KEY, name TEXT NOT NULL, amount REAL NOT NULL, cycle TEXT NOT NULL DEFAULT 'month', next_charge TEXT NOT NULL, cancel_by TEXT, remind INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE shopping(id TEXT PRIMARY KEY, name TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '', section TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, done_at TEXT);
    CREATE TABLE pantry(id TEXT PRIMARY KEY, name TEXT NOT NULL, qty TEXT NOT NULL DEFAULT '', expires TEXT, created_at TEXT NOT NULL);
    CREATE TABLE workouts(id TEXT PRIMARY KEY, at TEXT NOT NULL, exercise TEXT NOT NULL, ex_key TEXT NOT NULL, sets INTEGER NOT NULL, reps INTEGER NOT NULL, weight REAL NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '');
    CREATE INDEX ix_workouts ON workouts(ex_key, at);
    CREATE TABLE deadlines(id TEXT PRIMARY KEY, title TEXT NOT NULL, due_at TEXT NOT NULL, course TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, ref TEXT, done INTEGER NOT NULL DEFAULT 0, reminded TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(source, ref));
  `),
];
