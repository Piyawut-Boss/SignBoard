// Fills an empty database with sample content (a coffee shop with 3 screens) so the app
// looks alive on first run. Safe to run repeatedly: it does nothing if media already exists.
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR } = require('./db');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (db.prepare('SELECT COUNT(*) n FROM media').get().n > 0) {
  console.log('Database already has media, skipping demo data.');
  process.exit(0);
}

const FONT = "'Noto Sans Thai','Sarabun','Tahoma',sans-serif";
const art = (c1, c2, title, sub) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="1280" height="720" fill="url(#g)"/><circle cx="1060" cy="150" r="270" fill="#fff" fill-opacity=".08"/><circle cx="1140" cy="650" r="190" fill="#fff" fill-opacity=".07"/><text x="90" y="330" font-family="${FONT}" font-size="118" font-weight="700" fill="#fff">${title}</text><text x="94" y="430" font-family="${FONT}" font-size="52" fill="#fff" fill-opacity=".88">${sub}</text></svg>`;

const images = [
  ['ลาเต้เย็น เมนูแนะนำ', '#7a4b2a', '#c98f5a', 'ลาเต้เย็น', 'เมนูแนะนำประจำสัปดาห์ 65.-'],
  ['โปรเช้า ซื้อ 1 แถม 1', '#e8590c', '#f59f00', 'ซื้อ 1 แถม 1', 'ทุกเมนูกาแฟ 07:00 - 11:00 น.'],
  ['เค้กช็อกโกแลตเข้มข้น', '#3b2a28', '#7b3f3a', 'เค้กช็อกโกแลต', 'เมนูใหม่ ชิ้นละ 89.-'],
  ['Happy Hour ช่วงเย็น', '#5f3dc4', '#e64980', 'Happy Hour', 'เครื่องดื่มทุกแก้ว ลด 30% หลัง 17:00'],
  ['Wi-Fi ฟรีทั้งร้าน', '#0b7285', '#22b8cf', 'Wi-Fi ฟรี', 'รหัสผ่าน: coffee2026'],
  ['ขอบคุณที่มาอุดหนุน', '#2b8a3e', '#69db7c', 'ขอบคุณค่ะ', 'แล้วพบกันใหม่ ติดตามเราที่ @cafesiam'],
];
const mediaIds = images.map(([name, c1, c2, title, sub], i) => {
  const filename = `demo-${i + 1}.svg`;
  const svg = art(c1, c2, title, sub);
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), svg);
  return Number(db.prepare("INSERT INTO media (name, type, url, filename, size, duration) VALUES (?, 'image', ?, ?, ?, 5)")
    .run(name, `/uploads/${filename}`, filename, Buffer.byteLength(svg)).lastInsertRowid);
});

const playlist = (name, idx) => {
  const id = Number(db.prepare('INSERT INTO playlists (name) VALUES (?)').run(name).lastInsertRowid);
  idx.forEach((m, pos) => db.prepare('INSERT INTO playlist_items (playlist_id, media_id, position, duration) VALUES (?, ?, ?, 8)').run(id, mediaIds[m], pos));
  return id;
};
const menu = playlist('เมนูแนะนำ', [0, 2, 4, 5]);
const morning = playlist('โปรเช้า', [1, 0, 5]);
const evening = playlist('โปรเย็น', [3, 2, 5]);

const screen = (name, location, pl) => Number(db.prepare('INSERT INTO screens (name, location, device_token, playlist_id) VALUES (?, ?, ?, ?)')
  .run(name, location, require('crypto').randomBytes(16).toString('hex'), pl).lastInsertRowid);
const front = screen('จอหน้าร้าน', 'สาขาสยาม ชั้น 1', menu);
const counter = screen('จอเคาน์เตอร์', 'สาขาสยาม ชั้น 1', morning);
screen('จอห้องประชุม', 'สำนักงานใหญ่ ชั้น 5', menu);

const sched = db.prepare('INSERT INTO schedules (screen_id, playlist_id, days, start_time, end_time, priority) VALUES (?, ?, ?, ?, ?, 1)');
sched.run(front, morning, '1,2,3,4,5', '07:00', '11:00');
sched.run(front, evening, '0,1,2,3,4,5,6', '17:00', '21:00');
sched.run(counter, evening, '0,1,2,3,4,5,6', '15:00', '23:00');

console.log('Demo data added: 6 images, 3 playlists, 3 screens, 3 schedules.');
