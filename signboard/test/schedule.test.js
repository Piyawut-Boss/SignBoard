process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'signage-test-'));
const test = require('node:test');
const assert = require('node:assert');
const { db } = require('../src/db');
const { resolvePlaylist, timeInWindow } = require('../src/server');

test('timeInWindow handles normal, overnight and all-day windows', () => {
  assert.ok(timeInWindow('09:00', '08:00', '18:00'));
  assert.ok(!timeInWindow('18:00', '08:00', '18:00'));
  assert.ok(timeInWindow('23:30', '22:00', '06:00'));
  assert.ok(timeInWindow('05:59', '22:00', '06:00'));
  assert.ok(!timeInWindow('12:00', '22:00', '06:00'));
  assert.ok(timeInWindow('03:00', '00:00', '00:00'));
});

test('resolvePlaylist picks the highest-priority matching schedule, else the default', () => {
  const pl = (n) => Number(db.prepare('INSERT INTO playlists (name) VALUES (?)').run(n).lastInsertRowid);
  const def = pl('default'), lunch = pl('lunch'), promo = pl('promo');
  const screenId = Number(db.prepare("INSERT INTO screens (name, device_token, playlist_id) VALUES ('s', 'tok', ?)").run(def).lastInsertRowid);
  const add = db.prepare('INSERT INTO schedules (screen_id, playlist_id, days, start_time, end_time, start_date, end_date, priority) VALUES (?,?,?,?,?,?,?,?)');
  add.run(screenId, lunch, '1,2,3,4,5', '11:00', '13:00', null, null, 0);
  add.run(screenId, promo, '0,1,2,3,4,5,6', '12:00', '12:30', '2026-11-01', '2026-11-30', 5);
  const screen = db.prepare('SELECT * FROM screens WHERE id = ?').get(screenId);

  assert.strictEqual(resolvePlaylist(screen, { day: 1, time: '11:30', date: '2026-10-26' }).playlistId, lunch);
  assert.strictEqual(resolvePlaylist(screen, { day: 1, time: '12:10', date: '2026-10-26' }).playlistId, lunch); // promo not started yet
  assert.strictEqual(resolvePlaylist(screen, { day: 1, time: '12:10', date: '2026-11-02' }).playlistId, promo);
  assert.strictEqual(resolvePlaylist(screen, { day: 6, time: '11:30', date: '2026-10-31' }).playlistId, def); // Saturday
  assert.strictEqual(resolvePlaylist(screen, { day: 1, time: '15:00', date: '2026-10-26' }).playlistId, def);
});
