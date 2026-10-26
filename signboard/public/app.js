(() => {
  const root = document.getElementById('root');
  const DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const TYPE_LABEL = { image: 'รูปภาพ', video: 'วิดีโอ', web: 'เว็บเพจ' };
  let me = null;
  let refreshTimer = null;

  // ---------- utils ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtBytes = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');
  const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)} นาที ${s % 60} วิ` : `${s} วิ`);

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      ...opts,
      headers: opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
      body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/auth/login') { me = null; renderLogin(); throw new Error(data.error); }
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    return data;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }

  function modal(title, bodyHtml, { submitLabel = 'บันทึก', onSubmit, danger = false } = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<form class="modal"><h2>${esc(title)}</h2>${bodyHtml}
      <div class="error"></div>
      <div class="actions"><button type="button" class="btn" data-close>ยกเลิก</button>
      ${onSubmit ? `<button class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}</div></form>`;
    const close = () => bg.remove();
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.dataset.close != null) close(); });
    const form = bg.querySelector('form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await onSubmit(form); close(); } catch (err) { form.querySelector('.error').textContent = err.message; }
    });
    document.body.appendChild(bg);
    const first = form.querySelector('input, select');
    if (first) first.focus();
    return form;
  }

  const confirmBox = (text, onYes) =>
    modal('ยืนยัน', `<p>${esc(text)}</p>`, { submitLabel: 'ลบ', danger: true, onSubmit: onYes });

  function thumb(m) {
    if (m.type === 'image') return `<div class="thumb"><img src="${esc(m.url)}" loading="lazy" alt=""></div>`;
    if (m.type === 'video') return `<div class="thumb"><video src="${esc(m.url)}#t=1" muted preload="metadata"></video></div>`;
    return `<div class="thumb">🌐</div>`;
  }

  // ---------- shell ----------
  const NAV = [
    ['dashboard', '📊', 'ภาพรวม'],
    ['screens', '🖥️', 'จอแสดงผล'],
    ['media', '🖼️', 'คลังสื่อ'],
    ['playlists', '🎞️', 'เพลย์ลิสต์'],
    ['schedules', '🗓️', 'ตารางเวลา'],
    ['settings', '⚙️', 'ตั้งค่า'],
  ];

  function shell(active, content) {
    root.innerHTML = `<div class="app">
      <aside class="side">
        <div class="logo"><span>▶</span>SignBoard</div>
        <nav class="nav">${NAV.map(([k, i, l]) => `<a href="#/${k}" class="${k === active ? 'active' : ''}">${i} ${l}</a>`).join('')}</nav>
        <div class="spacer"></div>
        <div class="user">👤 ${esc(me.username)} · <a href="#" id="logout">ออกจากระบบ</a></div>
      </aside>
      <main class="main" id="main">${content}</main></div>`;
    document.getElementById('logout').onclick = async (e) => {
      e.preventDefault();
      await api('/auth/logout', { method: 'POST' });
      me = null;
      renderLogin();
    };
    return document.getElementById('main');
  }

  function renderLogin() {
    clearInterval(refreshTimer);
    root.innerHTML = `<div class="login"><form class="card">
      <div class="logo" style="color:var(--ink);padding:0 0 12px"><span style="color:#fff">▶</span>SignBoard</div>
      <p class="muted" style="margin-top:0">เข้าสู่ระบบจัดการป้ายดิจิทัล</p>
      <label>ชื่อผู้ใช้</label><input name="username" autocomplete="username" required>
      <label>รหัสผ่าน</label><input name="password" type="password" autocomplete="current-password" required>
      <div class="error"></div>
      <button class="btn primary" style="width:100%;justify-content:center;margin-top:8px">เข้าสู่ระบบ</button></form></div>`;
    const form = root.querySelector('form');
    form.onsubmit = async (e) => {
      e.preventDefault();
      try {
        me = await api('/auth/login', { method: 'POST', body: { username: form.username.value, password: form.password.value } });
        if (!location.hash || location.hash === '#/') location.hash = '#/dashboard';
        route();
      } catch (err) { form.querySelector('.error').textContent = err.message; }
    };
  }

  // ---------- dashboard ----------
  async function pageDashboard() {
    const [s, screens] = await Promise.all([api('/stats'), api('/screens')]);
    const main = shell('dashboard', `
      <div class="head"><div><h1>ภาพรวม</h1><p>สถานะจอและเนื้อหาทั้งหมด</p></div>
        <a class="btn" href="/player" target="_blank">เปิดหน้า Player ↗</a></div>
      <div class="grid stats">
        <div class="card stat"><div class="n">${s.online}/${s.screens}</div><div class="l">จอออนไลน์</div></div>
        <div class="card stat"><div class="n">${s.media}</div><div class="l">ไฟล์สื่อ · ${fmtBytes(s.storage)}</div></div>
        <div class="card stat"><div class="n">${s.playlists}</div><div class="l">เพลย์ลิสต์</div></div>
        <div class="card stat"><div class="n">${s.schedules}</div><div class="l">ตารางเวลา</div></div>
      </div>
      <div class="card" style="margin-top:18px"><h2>จอแสดงผล</h2>
        ${screens.length ? `<div class="table-wrap"><table><tr><th>จอ</th><th>สถานะ</th><th>กำลังเล่น</th></tr>
          ${screens.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="muted">${esc(x.location)}</div></td>
            <td>${statusBadge(x)}</td><td>${nowPlaying(x)}</td></tr>`).join('')}</table></div>`
          : `<div class="empty">ยังไม่มีจอ เปิด <a href="/player" target="_blank">/player</a> บนจอที่ต้องการ แล้วไปที่ <a href="#/screens">จอแสดงผล</a> เพื่อจับคู่</div>`}
      </div>`);
    return main;
  }

  const statusBadge = (x) => (x.online ? '<span class="badge on">ออนไลน์</span>' : `<span class="badge off">ออฟไลน์</span>`);
  const nowPlaying = (x) => (x.now_playing
    ? `${esc(x.now_playing)} ${x.by_schedule ? '<span class="badge brand">ตามตาราง</span>' : ''}`
    : '<span class="muted">—</span>');

  // ---------- screens ----------
  async function pageScreens() {
    const [screens, playlists] = await Promise.all([api('/screens'), api('/playlists')]);
    const plOptions = (sel) => `<option value="">— ไม่มี —</option>` +
      playlists.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const main = shell('screens', `
      <div class="head"><div><h1>จอแสดงผล</h1><p>เปิด <a href="/player" target="_blank">${esc(location.origin)}/player</a> บนทีวีหรือคอมพิวเตอร์ แล้วกรอกรหัสที่ขึ้นบนจอ</p></div>
        <button class="btn primary" id="add">＋ เพิ่มจอ</button></div>
      <div class="card">${screens.length ? `<div class="table-wrap"><table>
        <tr><th>ชื่อจอ</th><th>สถานะ</th><th>เพลย์ลิสต์หลัก</th><th>กำลังเล่น</th><th></th></tr>
        ${screens.map((x) => `<tr data-id="${x.id}">
          <td><b>${esc(x.name)}</b><div class="muted">${esc(x.location)} ${x.orientation === 'portrait' ? '· แนวตั้ง' : ''}</div></td>
          <td>${statusBadge(x)}</td>
          <td><select data-pl>${plOptions(x.playlist_id)}</select></td>
          <td>${nowPlaying(x)}</td>
          <td class="row" style="justify-content:flex-end"><button class="btn sm" data-edit>แก้ไข</button><button class="btn sm danger" data-del>ลบ</button></td>
        </tr>`).join('')}</table></div>`
        : '<div class="empty">ยังไม่มีจอ กด “เพิ่มจอ” เพื่อจับคู่จอแรก</div>'}</div>`);

    main.querySelector('#add').onclick = () => modal('จับคู่จอใหม่', `
      <p class="muted">เปิด <b>/player</b> บนจอที่ต้องการ ระบบจะแสดงรหัส 6 ตัวอักษร</p>
      <label>รหัสจับคู่</label><input name="code" maxlength="6" style="text-transform:uppercase;letter-spacing:4px;font-size:20px" required>
      <label>ชื่อจอ</label><input name="name" placeholder="เช่น จอหน้าร้าน">
      <label>สถานที่</label><input name="location" placeholder="เช่น สาขาสยาม ชั้น 1">
      <label>เพลย์ลิสต์หลัก</label><select name="playlist_id">${plOptions(null)}</select>`,
    { submitLabel: 'จับคู่', onSubmit: async (f) => {
      await api('/screens/pair', { method: 'POST', body: { code: f.code.value, name: f.name.value, location: f.location.value, playlist_id: f.playlist_id.value || null } });
      toast('จับคู่จอสำเร็จ');
      route();
    } });

    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      const x = screens.find((s) => s.id === Number(tr.dataset.id));
      tr.querySelector('[data-pl]').onchange = async (e) => {
        await api(`/screens/${x.id}`, { method: 'PUT', body: { playlist_id: e.target.value ? Number(e.target.value) : null } });
        toast('อัปเดตแล้ว จอจะเปลี่ยนเนื้อหาภายใน 30 วินาที');
        route();
      };
      tr.querySelector('[data-edit]').onclick = () => modal('แก้ไขจอ', `
        <label>ชื่อจอ</label><input name="name" value="${esc(x.name)}" required>
        <label>สถานที่</label><input name="location" value="${esc(x.location)}">
        <label>การวางจอ</label><select name="orientation">
          <option value="landscape">แนวนอน</option><option value="portrait" ${x.orientation === 'portrait' ? 'selected' : ''}>แนวตั้ง (หมุน 90°)</option></select>`,
      { onSubmit: async (f) => {
        await api(`/screens/${x.id}`, { method: 'PUT', body: { name: f.name.value, location: f.location.value, orientation: f.orientation.value } });
        route();
      } });
      tr.querySelector('[data-del]').onclick = () => confirmBox(`ลบจอ “${x.name}”? จอนี้จะกลับไปหน้าจับคู่`, async () => {
        await api(`/screens/${x.id}`, { method: 'DELETE' });
        route();
      });
    });
    return main;
  }

  // ---------- media ----------
  async function pageMedia() {
    const media = await api('/media');
    const main = shell('media', `
      <div class="head"><div><h1>คลังสื่อ</h1><p>รูปภาพ วิดีโอ และเว็บเพจที่ใช้ในเพลย์ลิสต์</p></div>
        <div class="row"><button class="btn" id="web">＋ เว็บเพจ</button><button class="btn primary" id="pick">⬆ อัปโหลด</button></div></div>
      <input type="file" id="file" multiple accept="image/*,video/*" hidden>
      <div class="drop" id="drop">ลากไฟล์รูปภาพหรือวิดีโอมาวางที่นี่ <span id="progress"></span></div>
      ${media.length ? `<div class="media-grid">${media.map((m) => `<div class="tile" data-id="${m.id}">
        ${thumb(m).replace('<div class="thumb">', `<div class="thumb"><span class="badge type">${TYPE_LABEL[m.type]}</span>`)}
        <div class="meta"><div class="name" title="${esc(m.name)}">${esc(m.name)}</div>
          <div class="muted" style="font-size:12px">${m.size ? fmtBytes(m.size) : esc(m.url)}</div>
          <div class="row"><a class="btn sm" href="${esc(m.url)}" target="_blank">ดู</a><button class="btn sm" data-edit>แก้ไข</button><button class="btn sm danger" data-del>ลบ</button></div></div></div>`).join('')}</div>`
        : '<div class="empty card">ยังไม่มีไฟล์ เริ่มด้วยการอัปโหลดรูปหรือวิดีโอ</div>'}`);

    const fileInput = main.querySelector('#file');
    const drop = main.querySelector('#drop');
    main.querySelector('#pick').onclick = () => fileInput.click();
    fileInput.onchange = () => uploadFiles(fileInput.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(e.dataTransfer.files); };

    function uploadFiles(files) {
      if (!files.length) return;
      const fd = new FormData();
      [...files].forEach((f) => fd.append('files', f));
      const xhr = new XMLHttpRequest();
      const progress = main.querySelector('#progress');
      xhr.upload.onprogress = (e) => { progress.textContent = `· กำลังอัปโหลด ${Math.round((e.loaded / e.total) * 100)}%`; };
      xhr.onload = () => {
        if (xhr.status === 200) { toast(`อัปโหลด ${files.length} ไฟล์แล้ว`); route(); }
        else { progress.textContent = '· ' + (JSON.parse(xhr.responseText || '{}').error || 'อัปโหลดไม่สำเร็จ'); }
      };
      xhr.open('POST', '/api/media/upload');
      xhr.send(fd);
    }

    main.querySelector('#web').onclick = () => modal('เพิ่มเว็บเพจ', `
      <label>ชื่อ</label><input name="name" placeholder="เช่น หน้าเมนูร้าน">
      <label>URL</label><input name="url" type="url" placeholder="https://" required>
      <label>เวลาแสดง (วินาที)</label><input name="duration" type="number" min="1" value="30">
      <p class="muted" style="font-size:13px">บางเว็บไซต์ไม่อนุญาตให้แสดงใน iframe</p>`,
    { onSubmit: async (f) => {
      await api('/media/web', { method: 'POST', body: { name: f.name.value, url: f.url.value, duration: f.duration.value } });
      route();
    } });

    main.querySelectorAll('.tile').forEach((t) => {
      const m = media.find((x) => x.id === Number(t.dataset.id));
      t.querySelector('[data-edit]').onclick = () => modal('แก้ไขสื่อ', `
        <label>ชื่อ</label><input name="name" value="${esc(m.name)}" required>
        <label>เวลาแสดงเริ่มต้น (วินาที${m.type === 'video' ? ', 0 = เล่นจนจบ' : ''})</label>
        <input name="duration" type="number" min="0" value="${m.duration}">`,
      { onSubmit: async (f) => {
        await api(`/media/${m.id}`, { method: 'PUT', body: { name: f.name.value, duration: f.duration.value } });
        route();
      } });
      t.querySelector('[data-del]').onclick = () => confirmBox(`ลบ “${m.name}”? ไฟล์นี้จะถูกนำออกจากทุกเพลย์ลิสต์`, async () => {
        await api(`/media/${m.id}`, { method: 'DELETE' });
        route();
      });
    });
    return main;
  }

  // ---------- playlists ----------
  async function pagePlaylists() {
    const playlists = await api('/playlists');
    const main = shell('playlists', `
      <div class="head"><div><h1>เพลย์ลิสต์</h1><p>ลำดับเนื้อหาที่จะวนเล่นบนจอ</p></div>
        <button class="btn primary" id="add">＋ สร้างเพลย์ลิสต์</button></div>
      <div class="card">${playlists.length ? `<div class="table-wrap"><table>
        <tr><th>ชื่อ</th><th>จำนวนรายการ</th><th>ความยาวรวม</th><th></th></tr>
        ${playlists.map((p) => `<tr data-id="${p.id}"><td><a href="#/playlists/${p.id}"><b>${esc(p.name)}</b></a></td>
          <td>${p.item_count}</td><td>${fmtDur(p.total_duration)}</td>
          <td class="row" style="justify-content:flex-end"><a class="btn sm" href="#/playlists/${p.id}">แก้ไข</a><button class="btn sm danger" data-del>ลบ</button></td></tr>`).join('')}
        </table></div>` : '<div class="empty">ยังไม่มีเพลย์ลิสต์</div>'}</div>`);

    main.querySelector('#add').onclick = () => modal('สร้างเพลย์ลิสต์', `<label>ชื่อเพลย์ลิสต์</label><input name="name" required placeholder="เช่น โปรโมชันเดือนนี้">`,
      { submitLabel: 'สร้าง', onSubmit: async (f) => {
        const p = await api('/playlists', { method: 'POST', body: { name: f.name.value } });
        location.hash = `#/playlists/${p.id}`;
      } });
    main.querySelectorAll('[data-del]').forEach((b) => {
      const p = playlists.find((x) => x.id === Number(b.closest('tr').dataset.id));
      b.onclick = () => confirmBox(`ลบเพลย์ลิสต์ “${p.name}”? ตารางเวลาที่ใช้เพลย์ลิสต์นี้จะถูกลบด้วย`, async () => {
        await api(`/playlists/${p.id}`, { method: 'DELETE' });
        route();
      });
    });
    return main;
  }

  async function pagePlaylistEditor(id) {
    const [pl, media] = await Promise.all([api(`/playlists/${id}`), api('/media')]);
    let items = pl.items.map((i) => ({ ...i }));
    let dirty = false;
    const main = shell('playlists', `
      <div class="head"><div><a href="#/playlists">← เพลย์ลิสต์ทั้งหมด</a>
        <div class="row" style="margin-top:8px"><input id="name" value="${esc(pl.name)}" style="font-size:20px;font-weight:600;max-width:360px">
        <select id="transition" style="width:auto"><option value="fade">เปลี่ยนแบบเฟด</option><option value="none" ${pl.transition === 'none' ? 'selected' : ''}>ตัดทันที</option></select></div></div>
        <div class="row"><span class="muted" id="total"></span><button class="btn primary" id="save">บันทึก</button></div></div>
      <div class="editor">
        <div class="items" id="items"></div>
        <div class="card"><h2>คลังสื่อ</h2><p class="muted" style="margin-top:-6px;font-size:13px">กด ＋ เพื่อเพิ่มเข้าเพลย์ลิสต์</p>
          <div class="library">${media.length ? media.map((m) => `<div class="lib-item">${thumb(m)}
            <div><div style="font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name)}</div><div class="muted" style="font-size:12px">${TYPE_LABEL[m.type]}</div></div>
            <button class="btn sm" data-add="${m.id}">＋</button></div>`).join('')
            : '<div class="empty">ยังไม่มีไฟล์ <a href="#/media">อัปโหลด</a></div>'}</div></div>
      </div>`);

    const list = main.querySelector('#items');
    const markDirty = () => { dirty = true; main.querySelector('#save').textContent = 'บันทึก •'; };
    function draw() {
      const total = items.reduce((a, i) => a + Number(i.duration || 0), 0);
      main.querySelector('#total').textContent = `${items.length} รายการ · ${fmtDur(total)}`;
      if (!items.length) { list.innerHTML = '<div class="card empty">เพลย์ลิสต์ว่าง เพิ่มสื่อจากคลังด้านขวา</div>'; return; }
      list.innerHTML = items.map((i, idx) => `<div class="item" draggable="true" data-idx="${idx}">
        <div class="handle" title="ลากเพื่อเรียงลำดับ">⋮⋮</div>${thumb(i)}
        <div style="min-width:0"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(i.name)}</div><div class="muted" style="font-size:12px">${TYPE_LABEL[i.type]}</div></div>
        <div><input type="number" min="0" value="${i.duration}" data-dur title="วินาที${i.type === 'video' ? ' (0 = เล่นจนจบ)' : ''}"><div class="muted" style="font-size:11px">วินาที${i.type === 'video' ? ' · 0=จนจบ' : ''}</div></div>
        <div class="row"><button class="btn sm" data-up ${idx === 0 ? 'disabled' : ''}>↑</button><button class="btn sm" data-down ${idx === items.length - 1 ? 'disabled' : ''}>↓</button><button class="btn sm danger" data-rm>✕</button></div></div>`).join('');
      list.querySelectorAll('.item').forEach((el) => {
        const idx = Number(el.dataset.idx);
        const move = (to) => { const [x] = items.splice(idx, 1); items.splice(to, 0, x); markDirty(); draw(); };
        el.querySelector('[data-dur]').oninput = (e) => { items[idx].duration = Number(e.target.value); markDirty(); };
        el.querySelector('[data-dur]').onchange = draw;
        el.querySelector('[data-up]').onclick = () => move(idx - 1);
        el.querySelector('[data-down]').onclick = () => move(idx + 1);
        el.querySelector('[data-rm]').onclick = () => { items.splice(idx, 1); markDirty(); draw(); };
        el.ondragstart = (e) => { e.dataTransfer.setData('text/plain', idx); el.classList.add('dragging'); };
        el.ondragend = () => el.classList.remove('dragging');
        el.ondragover = (e) => e.preventDefault();
        el.ondrop = (e) => {
          e.preventDefault();
          const from = Number(e.dataTransfer.getData('text/plain'));
          if (from === idx) return;
          const [x] = items.splice(from, 1);
          items.splice(idx, 0, x);
          markDirty();
          draw();
        };
      });
    }
    draw();

    main.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => {
        const m = media.find((x) => x.id === Number(b.dataset.add));
        items.push({ media_id: m.id, name: m.name, type: m.type, url: m.url, duration: m.duration });
        markDirty();
        draw();
      };
    });
    main.querySelector('#name').oninput = markDirty;
    main.querySelector('#transition').onchange = markDirty;
    main.querySelector('#save').onclick = async () => {
      try {
        await api(`/playlists/${id}`, { method: 'PUT', body: {
          name: main.querySelector('#name').value,
          transition: main.querySelector('#transition').value,
          items: items.map((i) => ({ media_id: i.media_id, duration: i.duration })),
        } });
        dirty = false;
        main.querySelector('#save').textContent = 'บันทึก';
        toast('บันทึกแล้ว จอที่ใช้เพลย์ลิสต์นี้จะอัปเดตภายใน 30 วินาที');
      } catch (e) { toast(e.message); }
    };
    window.onbeforeunload = () => (dirty ? true : undefined);
    return main;
  }

  // ---------- schedules ----------
  async function pageSchedules() {
    const [schedules, screens, playlists] = await Promise.all([api('/schedules'), api('/screens'), api('/playlists')]);
    const main = shell('schedules', `
      <div class="head"><div><h1>ตารางเวลา</h1><p>กำหนดให้จอเล่นเพลย์ลิสต์ตามวันและช่วงเวลา ถ้าไม่ตรงตารางใดจะเล่นเพลย์ลิสต์หลักของจอ</p></div>
        <button class="btn primary" id="add" ${!screens.length || !playlists.length ? 'disabled' : ''}>＋ เพิ่มตารางเวลา</button></div>
      <div class="card">${schedules.length ? `<div class="table-wrap"><table>
        <tr><th>จอ</th><th>เพลย์ลิสต์</th><th>วัน</th><th>เวลา</th><th>ช่วงวันที่</th><th>ลำดับความสำคัญ</th><th></th></tr>
        ${schedules.map((s) => `<tr data-id="${s.id}"><td><b>${esc(s.screen_name)}</b></td><td>${esc(s.playlist_name)}</td>
          <td>${s.days.split(',').length === 7 ? 'ทุกวัน' : s.days.split(',').map((d) => DAYS[d]).join(' ')}</td>
          <td>${s.start_time}–${s.end_time}</td>
          <td>${s.start_date || s.end_date ? `${s.start_date || '…'} ถึง ${s.end_date || '…'}` : '<span class="muted">ไม่จำกัด</span>'}</td>
          <td>${s.priority}</td>
          <td class="row" style="justify-content:flex-end"><button class="btn sm" data-edit>แก้ไข</button><button class="btn sm danger" data-del>ลบ</button></td></tr>`).join('')}
        </table></div>` : `<div class="empty">${!screens.length || !playlists.length ? 'ต้องมีจออย่างน้อย 1 จอและเพลย์ลิสต์อย่างน้อย 1 รายการก่อน' : 'ยังไม่มีตารางเวลา'}</div>`}</div>`);

    const form = (s = {}) => {
      const days = (s.days || '0,1,2,3,4,5,6').split(',').map(Number);
      return `<label>จอ</label><select name="screen_id">${screens.map((x) => `<option value="${x.id}" ${x.id === s.screen_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
        <label>เพลย์ลิสต์</label><select name="playlist_id">${playlists.map((p) => `<option value="${p.id}" ${p.id === s.playlist_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <label>วัน</label><div class="days">${DAYS.map((d, i) => `<label><input type="checkbox" name="day" value="${i}" ${days.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
        <div class="two"><div><label>เริ่ม</label><input type="time" name="start_time" value="${s.start_time || '08:00'}" required></div>
          <div><label>สิ้นสุด</label><input type="time" name="end_time" value="${s.end_time || '18:00'}" required></div></div>
        <div class="two"><div><label>ตั้งแต่วันที่ (ไม่บังคับ)</label><input type="date" name="start_date" value="${s.start_date || ''}"></div>
          <div><label>ถึงวันที่ (ไม่บังคับ)</label><input type="date" name="end_date" value="${s.end_date || ''}"></div></div>
        <label>ลำดับความสำคัญ (ตัวเลขมากชนะเมื่อเวลาทับกัน)</label><input type="number" name="priority" value="${s.priority || 0}">`;
    };
    const values = (f) => ({
      screen_id: f.screen_id.value, playlist_id: f.playlist_id.value,
      days: [...f.querySelectorAll('[name=day]:checked')].map((c) => c.value),
      start_time: f.start_time.value, end_time: f.end_time.value,
      start_date: f.start_date.value, end_date: f.end_date.value, priority: f.priority.value,
    });

    main.querySelector('#add').onclick = () => modal('เพิ่มตารางเวลา', form(), { onSubmit: async (f) => {
      await api('/schedules', { method: 'POST', body: values(f) });
      route();
    } });
    main.querySelectorAll('tr[data-id]').forEach((tr) => {
      const s = schedules.find((x) => x.id === Number(tr.dataset.id));
      tr.querySelector('[data-edit]').onclick = () => modal('แก้ไขตารางเวลา', form(s), { onSubmit: async (f) => {
        await api(`/schedules/${s.id}`, { method: 'PUT', body: values(f) });
        route();
      } });
      tr.querySelector('[data-del]').onclick = () => confirmBox('ลบตารางเวลานี้?', async () => {
        await api(`/schedules/${s.id}`, { method: 'DELETE' });
        route();
      });
    });
    return main;
  }

  // ---------- settings ----------
  async function pageSettings() {
    const main = shell('settings', `
      <div class="head"><div><h1>ตั้งค่า</h1></div></div>
      <form class="card" style="max-width:440px"><h2>เปลี่ยนรหัสผ่าน</h2>
        <label>รหัสผ่านปัจจุบัน</label><input type="password" name="current" required>
        <label>รหัสผ่านใหม่</label><input type="password" name="next" minlength="6" required>
        <div class="error"></div><button class="btn primary">บันทึก</button></form>`);
    const f = main.querySelector('form');
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/auth/password', { method: 'POST', body: { current: f.current.value, next: f.next.value } });
        f.reset();
        toast('เปลี่ยนรหัสผ่านแล้ว');
      } catch (err) { f.querySelector('.error').textContent = err.message; }
    };
    return main;
  }

  // ---------- router ----------
  async function route() {
    clearInterval(refreshTimer);
    window.onbeforeunload = null;
    if (!me) {
      try { me = await api('/auth/me'); } catch { return; }
    }
    const [, page, id] = (location.hash.replace(/^#/, '') || '/dashboard').split('/');
    try {
      if (page === 'screens') { await pageScreens(); refreshTimer = setInterval(() => !document.querySelector('.modal-bg') && route(), 20000); }
      else if (page === 'media') await pageMedia();
      else if (page === 'playlists' && id) await pagePlaylistEditor(Number(id));
      else if (page === 'playlists') await pagePlaylists();
      else if (page === 'schedules') await pageSchedules();
      else if (page === 'settings') await pageSettings();
      else { await pageDashboard(); refreshTimer = setInterval(() => route(), 20000); }
    } catch (e) {
      if (me) toast(e.message);
    }
  }

  window.addEventListener('hashchange', route);
  route();
})();
