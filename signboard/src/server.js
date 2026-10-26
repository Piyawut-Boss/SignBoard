const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, DATA_DIR, hashPassword, verifyPassword } = require('./db');

const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const ONLINE_WINDOW_SEC = 90;
const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('hex');

// ---------- helpers ----------
function wrap(fn) {
  return (req, res, next) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (e) {
      next(e);
    }
  };
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function requireAuth(req, res, next) {
  const token = req.cookies.sid || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  const row = db
    .prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?')
    .get(token);
  if (!row) return res.status(401).json({ error: 'เซสชันหมดอายุ' });
  req.user = row;
  next();
}

function screenWithStatus(s) {
  const online = s.last_seen
    ? (Date.now() - new Date(s.last_seen + 'Z').getTime()) / 1000 < ONLINE_WINDOW_SEC
    : false;
  return { ...s, device_token: undefined, online };
}

function touchPlaylist(id) {
  db.prepare("UPDATE playlists SET updated_at = datetime('now') WHERE id = ?").run(id);
}

function playlistItems(playlistId) {
  return db
    .prepare(
      `SELECT pi.id, pi.media_id, pi.position, pi.duration, m.name, m.type, m.url
       FROM playlist_items pi JOIN media m ON m.id = pi.media_id
       WHERE pi.playlist_id = ? ORDER BY pi.position, pi.id`
    )
    .all(playlistId);
}

function timeInWindow(time, start, end) {
  if (start === end) return true; // all day
  if (start < end) return time >= start && time < end;
  return time >= start || time < end; // overnight window, e.g. 22:00 - 06:00
}

// Find which playlist a screen should play at a given local day/time/date
function resolvePlaylist(screen, { day, time, date }) {
  const schedules = db
    .prepare('SELECT * FROM schedules WHERE screen_id = ? ORDER BY priority DESC, id DESC')
    .all(screen.id);
  for (const s of schedules) {
    const days = s.days.split(',').map(Number);
    if (!days.includes(day)) continue;
    if (s.start_date && date < s.start_date) continue;
    if (s.end_date && date > s.end_date) continue;
    if (!timeInWindow(time, s.start_time, s.end_time)) continue;
    return { playlistId: s.playlist_id, scheduleId: s.id };
  }
  return { playlistId: screen.playlist_id, scheduleId: null };
}

function localNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    day: d.getDay(),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  };
}

// ---------- auth ----------
app.post('/api/auth/login', wrap((req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username || '');
  if (!user || !verifyPassword(password || '', user.password_hash, user.salt)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
  res.json({ id: user.id, username: user.username });
}));

app.post('/api/auth/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

app.post('/api/auth/password', requireAuth, wrap((req, res) => {
  const { current, next: newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current || '', user.password_hash, user.salt)) return badRequest(res, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (!newPassword || newPassword.length < 6) return badRequest(res, 'รหัสผ่านใหม่ต้องยาวอย่างน้อย 6 ตัวอักษร');
  const { hash, salt } = hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(hash, salt, user.id);
  res.json({ ok: true });
}));

// ---------- dashboard ----------
app.get('/api/stats', requireAuth, (req, res) => {
  const screens = db.prepare('SELECT * FROM screens').all().map(screenWithStatus);
  res.json({
    screens: screens.length,
    online: screens.filter((s) => s.online).length,
    media: db.prepare('SELECT COUNT(*) n FROM media').get().n,
    playlists: db.prepare('SELECT COUNT(*) n FROM playlists').get().n,
    schedules: db.prepare('SELECT COUNT(*) n FROM schedules').get().n,
    storage: db.prepare('SELECT COALESCE(SUM(size),0) n FROM media').get().n,
  });
});

// ---------- media ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${randomToken(6)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image|video)\//.test(file.mimetype)),
});

app.get('/api/media', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM media ORDER BY id DESC').all());
});

app.post('/api/media/upload', requireAuth, upload.array('files', 20), wrap((req, res) => {
  if (!req.files || !req.files.length) return badRequest(res, 'รองรับเฉพาะไฟล์รูปภาพหรือวิดีโอ');
  const insert = db.prepare('INSERT INTO media (name, type, url, filename, size, duration) VALUES (?, ?, ?, ?, ?, ?)');
  const created = req.files.map((f) => {
    const type = f.mimetype.startsWith('video/') ? 'video' : 'image';
    // multer decodes names as latin1; restore UTF-8 so Thai filenames survive
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    const r = insert.run(name, type, `/uploads/${f.filename}`, f.filename, f.size, type === 'video' ? 0 : 10);
    return db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid);
  });
  res.json(created);
}));

app.post('/api/media/web', requireAuth, wrap((req, res) => {
  const { name, url, duration } = req.body || {};
  if (!/^https?:\/\//i.test(url || '')) return badRequest(res, 'URL ต้องขึ้นต้นด้วย http:// หรือ https://');
  const r = db
    .prepare("INSERT INTO media (name, type, url, duration) VALUES (?, 'web', ?, ?)")
    .run(name || url, url, Number(duration) || 30);
  res.json(db.prepare('SELECT * FROM media WHERE id = ?').get(r.lastInsertRowid));
}));

app.put('/api/media/:id', requireAuth, wrap((req, res) => {
  const { name, duration } = req.body || {};
  db.prepare('UPDATE media SET name = COALESCE(?, name), duration = COALESCE(?, duration) WHERE id = ?')
    .run(name ?? null, duration != null ? Number(duration) : null, req.params.id);
  res.json(db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id));
}));

app.delete('/api/media/:id', requireAuth, wrap((req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'ไม่พบไฟล์' });
  const affected = db.prepare('SELECT DISTINCT playlist_id FROM playlist_items WHERE media_id = ?').all(m.id);
  db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
  affected.forEach((p) => touchPlaylist(p.playlist_id));
  if (m.filename) fs.rm(path.join(UPLOAD_DIR, m.filename), { force: true }, () => {});
  res.json({ ok: true });
}));

// ---------- playlists ----------
app.get('/api/playlists', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, COUNT(pi.id) AS item_count, COALESCE(SUM(pi.duration),0) AS total_duration
       FROM playlists p LEFT JOIN playlist_items pi ON pi.playlist_id = p.id
       GROUP BY p.id ORDER BY p.id DESC`
    )
    .all();
  res.json(rows);
});

app.get('/api/playlists/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบเพลย์ลิสต์' });
  res.json({ ...p, items: playlistItems(p.id) });
});

app.post('/api/playlists', requireAuth, wrap((req, res) => {
  const { name } = req.body || {};
  if (!name) return badRequest(res, 'กรุณาตั้งชื่อเพลย์ลิสต์');
  const r = db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name);
  res.json(db.prepare('SELECT * FROM playlists WHERE id = ?').get(r.lastInsertRowid));
}));

// Replace name, transition and the whole ordered item list in one save
app.put('/api/playlists/:id', requireAuth, wrap((req, res) => {
  const id = Number(req.params.id);
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'ไม่พบเพลย์ลิสต์' });
  const { name, transition, items } = req.body || {};
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE playlists SET name = ?, transition = ? WHERE id = ?')
      .run(name || p.name, transition || p.transition, id);
    if (Array.isArray(items)) {
      db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(id);
      const ins = db.prepare('INSERT INTO playlist_items (playlist_id, media_id, position, duration) VALUES (?, ?, ?, ?)');
      items.forEach((it, i) => ins.run(id, Number(it.media_id), i, Math.max(0, Number.isFinite(Number(it.duration)) ? Number(it.duration) : 10)));
    }
    touchPlaylist(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ ...db.prepare('SELECT * FROM playlists WHERE id = ?').get(id), items: playlistItems(id) });
}));

app.delete('/api/playlists/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM playlists WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- screens ----------
app.get('/api/screens', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT s.*, p.name AS playlist_name FROM screens s LEFT JOIN playlists p ON p.id = s.playlist_id ORDER BY s.id DESC')
    .all();
  res.json(rows.map((s) => {
    const now = resolvePlaylist(s, localNow());
    const current = now.playlistId ? db.prepare('SELECT name FROM playlists WHERE id = ?').get(now.playlistId) : null;
    return { ...screenWithStatus(s), now_playing: current ? current.name : null, by_schedule: !!now.scheduleId };
  }));
});

// Admin enters the code shown on the player to claim it as a screen
app.post('/api/screens/pair', requireAuth, wrap((req, res) => {
  const { code, name, location, playlist_id } = req.body || {};
  const reqRow = db.prepare('SELECT * FROM pair_requests WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!reqRow) return badRequest(res, 'ไม่พบรหัสจับคู่นี้ ตรวจสอบรหัสบนหน้าจออีกครั้ง');
  const r = db
    .prepare('INSERT INTO screens (name, location, device_token, playlist_id) VALUES (?, ?, ?, ?)')
    .run(name || `จอ ${reqRow.code}`, location || '', reqRow.device_token, playlist_id || null);
  db.prepare('DELETE FROM pair_requests WHERE code = ?').run(reqRow.code);
  res.json(screenWithStatus(db.prepare('SELECT * FROM screens WHERE id = ?').get(r.lastInsertRowid)));
}));

app.put('/api/screens/:id', requireAuth, wrap((req, res) => {
  const s = db.prepare('SELECT * FROM screens WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'ไม่พบจอ' });
  const b = req.body || {};
  db.prepare('UPDATE screens SET name = ?, location = ?, playlist_id = ?, orientation = ? WHERE id = ?').run(
    b.name ?? s.name,
    b.location ?? s.location,
    b.playlist_id === undefined ? s.playlist_id : b.playlist_id || null,
    b.orientation ?? s.orientation,
    s.id
  );
  res.json(screenWithStatus(db.prepare('SELECT * FROM screens WHERE id = ?').get(s.id)));
}));

app.delete('/api/screens/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM screens WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- schedules ----------
app.get('/api/schedules', requireAuth, (req, res) => {
  res.json(
    db.prepare(
      `SELECT sc.*, s.name AS screen_name, p.name AS playlist_name
       FROM schedules sc JOIN screens s ON s.id = sc.screen_id JOIN playlists p ON p.id = sc.playlist_id
       ORDER BY s.name, sc.priority DESC, sc.start_time`
    ).all()
  );
});

function scheduleFields(b) {
  const timeRe = /^\d{2}:\d{2}$/;
  if (!b.screen_id || !b.playlist_id) return { error: 'กรุณาเลือกจอและเพลย์ลิสต์' };
  if (!timeRe.test(b.start_time || '') || !timeRe.test(b.end_time || '')) return { error: 'รูปแบบเวลาไม่ถูกต้อง' };
  const days = Array.isArray(b.days) ? b.days.join(',') : String(b.days || '');
  if (!days) return { error: 'กรุณาเลือกอย่างน้อยหนึ่งวัน' };
  return {
    values: [Number(b.screen_id), Number(b.playlist_id), days, b.start_time, b.end_time,
      b.start_date || null, b.end_date || null, Number(b.priority) || 0],
  };
}

app.post('/api/schedules', requireAuth, wrap((req, res) => {
  const f = scheduleFields(req.body || {});
  if (f.error) return badRequest(res, f.error);
  const r = db.prepare(
    `INSERT INTO schedules (screen_id, playlist_id, days, start_time, end_time, start_date, end_date, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(...f.values);
  res.json(db.prepare('SELECT * FROM schedules WHERE id = ?').get(r.lastInsertRowid));
}));

app.put('/api/schedules/:id', requireAuth, wrap((req, res) => {
  const f = scheduleFields(req.body || {});
  if (f.error) return badRequest(res, f.error);
  db.prepare(
    `UPDATE schedules SET screen_id=?, playlist_id=?, days=?, start_time=?, end_time=?, start_date=?, end_date=?, priority=?
     WHERE id = ?`
  ).run(...f.values, req.params.id);
  res.json(db.prepare('SELECT * FROM schedules WHERE id = ?').get(req.params.id));
}));

app.delete('/api/schedules/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- player (public, authenticated by device token) ----------
function newPairCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
  for (;;) {
    const code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
    if (!db.prepare('SELECT 1 FROM pair_requests WHERE code = ?').get(code)) return code;
  }
}

app.post('/api/player/register', wrap((req, res) => {
  let token = String((req.body || {}).device_token || '');
  if (!/^[a-f0-9]{32,64}$/.test(token)) token = randomToken();
  const screen = db.prepare('SELECT * FROM screens WHERE device_token = ?').get(token);
  if (screen) return res.json({ device_token: token, paired: true, screen: { id: screen.id, name: screen.name } });
  let pr = db.prepare('SELECT * FROM pair_requests WHERE device_token = ?').get(token);
  if (!pr) {
    const code = newPairCode();
    db.prepare('INSERT INTO pair_requests (code, device_token) VALUES (?, ?)').run(code, token);
    pr = { code };
  }
  res.json({ device_token: token, paired: false, code: pr.code });
}));

app.get('/api/player/content', wrap((req, res) => {
  const screen = db.prepare('SELECT * FROM screens WHERE device_token = ?').get(String(req.query.token || ''));
  if (!screen) return res.status(404).json({ error: 'unpaired' });
  db.prepare("UPDATE screens SET last_seen = datetime('now') WHERE id = ?").run(screen.id);

  const fallback = localNow();
  const when = {
    day: req.query.day != null ? Number(req.query.day) : fallback.day,
    time: /^\d{2}:\d{2}$/.test(req.query.time || '') ? req.query.time : fallback.time,
    date: /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : fallback.date,
  };
  const { playlistId } = resolvePlaylist(screen, when);
  const playlist = playlistId ? db.prepare('SELECT * FROM playlists WHERE id = ?').get(playlistId) : null;
  const items = playlist ? playlistItems(playlist.id) : [];
  const payload = {
    screen: { id: screen.id, name: screen.name, orientation: screen.orientation },
    playlist: playlist ? { id: playlist.id, name: playlist.name, transition: playlist.transition } : null,
    items: items.map((i) => ({ id: i.id, type: i.type, url: i.url, duration: i.duration, name: i.name })),
  };
  payload.version = crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  res.json(payload);
}));

app.get('/player', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'player.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'เกิดข้อผิดพลาด' });
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Signage server running on http://localhost:${PORT}`));
}

module.exports = { app, resolvePlaylist, timeInWindow };
