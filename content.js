// Reels Auto Next v3 — Facebook Reels + TikTok — by XMAN Studio
(() => {
  const SITE = location.hostname.includes('tiktok') ? 'tiktok' : 'facebook';

  const ADAPTERS = {
    facebook: {
      active: () => /\/reels?\//.test(location.pathname),
      nextLabels: ['การ์ดถัดไป', 'Next card', 'รายการถัดไป'],
      nextSelectors: [],
      itemSelector: null,
      author(box) {
        const bad = /\/(reel|reels|hashtag|watch|ads|groups\/.*\/posts|stories|photo|music|audio)\b|l\.facebook\.com|\/sound\//i;
        for (const a of box.querySelectorAll('a[href]')) {
          const name = a.innerText.trim();
          if (!name || name.startsWith('#') || name.length > 60) continue;
          let u; try { u = new URL(a.href, location.href); } catch { continue; }
          if (!/facebook\.com$/.test(u.hostname) || bad.test(u.href)) continue;
          const id = u.pathname === '/profile.php' ? 'id:' + u.searchParams.get('id')
                   : u.pathname.split('/').filter(Boolean)[0];
          if (id && id !== 'id:null') return { id: id.toLowerCase(), name };
        }
        return null;
      }
    },
    tiktok: {
      active: () => !!document.querySelector('video'),
      nextLabels: ['Go to next video', 'ไปยังวิดีโอถัดไป', 'วิดีโอถัดไป', 'Next video'],
      nextSelectors: ['[data-e2e="feed-navigation-next"]', '[data-e2e="arrow-right"]'],
      itemSelector: 'article, [data-e2e="recommend-list-item-container"]',
      author(box) {
        const a = box.querySelector('[data-e2e="video-author-avatar"]') || box.querySelector('a[href^="/@"]');
        const m = a && a.getAttribute('href').match(/\/@([^/?]+)/);
        if (!m) return null;
        const nameEl = [...box.querySelectorAll('a[href^="/@"]')].find(x => x.innerText.trim());
        return { id: m[1].toLowerCase(), name: nameEl ? nameEl.innerText.trim().split('\n')[0] : '@' + m[1] };
      }
    }
  };
  const A = ADAPTERS[SITE];

  const AD_EXACT = new Set([
    'sponsored', 'ได้รับการสนับสนุน', 'โฆษณา', 'ad', 'ads', 'promoted', 'paid partnership',
    'ผู้สนับสนุน', 'เนื้อหาที่ได้รับการสนับสนุน', 'สปอนเซอร์'
  ]);
  const AD_SELECTORS = [
    '[data-e2e="ad-tag"]', '[data-e2e="video-ad-tag"]', '[data-e2e="ad-label"]', '[data-e2e="video-ad"]',
    '[data-e2e^="ad-"]', 'a[href*="/ads/about"]', 'a[aria-label="Sponsored"]', 'a[aria-label="ได้รับการสนับสนุน"]'
  ];

  // ป้ายเนื้อหา AI (TikTok: data-e2e="aigc-tag", FB: "เนื้อหาที่สร้างโดย AI" / "AI info")
  const AI_SELECTORS = ['[data-e2e="aigc-tag"]', '[data-e2e*="aigc"]', '[aria-label="AI info"]', '[aria-label="ข้อมูล AI"]'];
  const AI_EXACT = new Set([
    'contains ai-generated media', 'creator labeled as ai-generated', 'ai-generated', 'ai generated',
    'made with ai', 'ai info', 'ข้อมูล ai', 'เนื้อหาที่สร้างโดย ai', 'สร้างโดย ai', 'สร้างด้วย ai',
    'มีสื่อที่สร้างโดย ai', 'ผู้สร้างระบุว่าสร้างโดย ai', 'มีเนื้อหาที่สร้างโดย ai', 'ai-generated content'
  ]);

  // ---------- settings ----------
  let settings = { enabled: true, skipAds: true, skipBanned: true, showBanBtn: true, skipAI: false, showAIBadge: true, delay: 300 };
  let banned = {};          // key "site:id" -> {site,id,name,at}
  let stats = { adsSkipped: 0, bannedSkipped: 0, aiSkipped: 0 };
  chrome.storage.sync.get(settings, s => (settings = { ...settings, ...s }));
  chrome.storage.local.get({ banned: {}, stats }, s => { banned = s.banned; stats = { ...stats, ...s.stats }; });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'sync') for (const k in c) settings[k] = c[k].newValue;
    if (area === 'local') {
      if (c.banned) banned = c.banned.newValue || {};
      if (c.stats) stats = c.stats.newValue || stats;
    }
  });
  const bump = k => { stats[k] = (stats[k] || 0) + 1; chrome.storage.local.set({ stats }); };
  const keyOf = au => `${SITE}:${au.id}`;

  // ---------- helpers ----------
  let watched = null, lastTime = 0, advancing = false, checks = 0;

  const visibleArea = el => {
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  };
  const currentVideo = () => {
    const vids = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 && visibleArea(v) > 20000);
    return vids.find(v => !v.paused) || vids.sort((a, b) => visibleArea(b) - visibleArea(a))[0] || null;
  };
  const containerOf = v => {
    if (A.itemSelector) { const it = v.closest(A.itemSelector); if (it) return it; }
    let el = v;
    while (el.parentElement) {
      const p = el.parentElement;
      if (p.querySelectorAll('video').length > 1 || p.getBoundingClientRect().height > innerHeight * 1.5) break;
      el = p;
    }
    return el;
  };
  const isAd = box => {
    if (AD_SELECTORS.some(s => box.querySelector(s))) return true;
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let n, i = 0;
    while ((n = w.nextNode()) && i++ < 400) {
      const t = n.nodeValue.trim().toLowerCase();
      if (t && t.length < 40 && AD_EXACT.has(t)) return true;
    }
    for (const el of box.querySelectorAll('[aria-label]'))
      if (AD_EXACT.has(el.getAttribute('aria-label').trim().toLowerCase())) return true;
    return false;
  };
  const hasLabel = (box, selectors, exact) => {
    if (selectors.some(s => box.querySelector(s))) return true;
    const w = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    let n, i = 0;
    while ((n = w.nextNode()) && i++ < 400) {
      const t = n.nodeValue.trim().toLowerCase().replace(/\s+/g, ' ');
      if (t && t.length < 60 && exact.has(t)) return true;
    }
    for (const el of box.querySelectorAll('[aria-label]'))
      if (exact.has(el.getAttribute('aria-label').trim().toLowerCase())) return true;
    return false;
  };
  const isAI = box => hasLabel(box, AI_SELECTORS, AI_EXACT);

  const findNextButton = () => {
    const c = [
      ...A.nextSelectors.flatMap(s => [...document.querySelectorAll(s)]),
      ...A.nextLabels.flatMap(l => [...document.querySelectorAll(`[aria-label="${l}"]`)])
    ];
    return c.find(el => {
      const r = el.getBoundingClientRect();
      return r.width && r.height && el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
    }) || null;
  };
  const scrollFeed = v => {
    let el = v;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) {
        el.scrollBy({ top: el.clientHeight, behavior: 'smooth' }); return;
      }
      el = el.parentElement;
    }
    window.scrollBy({ top: innerHeight, behavior: 'smooth' });
  };

  const goNext = (reason, wait = settings.delay, msg) => {
    if (advancing || !A.active()) return;
    if (reason === 'end' && !settings.enabled) return;
    advancing = true;
    const v = watched;
    setTimeout(() => {
      const btn = findNextButton();
      if (btn) btn.click();
      else {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, bubbles: true }));
        setTimeout(() => { if (currentVideo() === v) scrollFeed(v); }, 600);
      }
      if (msg) toast(msg);
      setTimeout(() => (advancing = false), 1200);
    }, wait);
  };

  // ตรวจโฆษณา + ช่องที่แบน ช่วงแรกของคลิป
  const inspect = v => {
    const box = containerOf(v);
    if (settings.skipBanned) {
      const au = A.author(box);
      if (au && banned[keyOf(au)]) { bump('bannedSkipped'); goNext('banned', 100, `🚫 ข้ามช่องที่แบน: ${au.name}`); return true; }
    }
    if (settings.skipAds && isAd(box)) { bump('adsSkipped'); goNext('ad', 150, '⏭ ข้ามโฆษณาแล้ว'); return true; }
    if (settings.skipAI && isAI(box)) { bump('aiSkipped'); goNext('ai', 150, '🤖 ข้ามคลิปเนื้อหา AI'); return true; }
    return false;
  };

  const onTime = e => {
    const v = e.target;
    if (v !== watched || !v.duration || !isFinite(v.duration)) return;
    if (checks < 8 && v.currentTime > 0.2) { checks++; if (inspect(v)) { checks = 99; return; } }
    const d = v.duration;
    if (d - v.currentTime < 0.35) goNext('end');
    else if (lastTime > d - 1.2 && v.currentTime < 1 && d > 2) goNext('end');
    lastTime = v.currentTime;
  };
  const onEnded = () => goNext('end');

  const attach = () => {
    if (!A.active()) { banBtn && (banBtn.style.display = 'none'); aiBadge && (aiBadge.style.display = 'none'); return; }
    const v = currentVideo();
    updateBanBtn(v);
    if (!v || v === watched) return;
    if (watched) { watched.removeEventListener('timeupdate', onTime); watched.removeEventListener('ended', onEnded); }
    watched = v; lastTime = 0; checks = 0;
    v.loop = false;
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnded);
    if (!v.paused) setTimeout(() => watched === v && checks < 99 && inspect(v) && (checks = 99), 400);
  };

  // ---------- ปุ่มแบนช่อง ----------
  let banBtn, curAuthor = null;
  const css = (el, s) => Object.assign(el.style, s);
  const makeBanBtn = () => {
    banBtn = document.createElement('button');
    banBtn.type = 'button';
    css(banBtn, {
      position: 'fixed', zIndex: 2147483646, display: 'none', border: '0', cursor: 'pointer',
      background: 'rgba(220,38,38,.88)', color: '#fff', padding: '6px 12px', borderRadius: '16px',
      font: '600 13px system-ui,sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.35)', maxWidth: '260px',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', opacity: '.85'
    });
    banBtn.onmouseenter = () => (banBtn.style.opacity = '1');
    banBtn.onmouseleave = () => (banBtn.style.opacity = '.85');
    banBtn.onclick = e => {
      e.preventDefault(); e.stopPropagation();
      if (!curAuthor) return;
      const k = keyOf(curAuthor);
      banned[k] = { site: SITE, id: curAuthor.id, name: curAuthor.name, at: Date.now() };
      chrome.storage.local.set({ banned });
      goNext('banned', 50, `🚫 แบน ${curAuthor.name} แล้ว — จะข้ามช่องนี้ตลอด`);
    };
    document.documentElement.appendChild(banBtn);
  };
  let aiBadge;
  const updateAIBadge = (v, box) => {
    if (!aiBadge) {
      aiBadge = document.createElement('div');
      aiBadge.textContent = '🤖 เนื้อหา AI';
      css(aiBadge, {
        position: 'fixed', zIndex: 2147483646, display: 'none', pointerEvents: 'none',
        background: 'rgba(124,58,237,.9)', color: '#fff', padding: '6px 12px', borderRadius: '16px',
        font: '600 13px system-ui,sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.35)'
      });
      document.documentElement.appendChild(aiBadge);
    }
    if (!v || !settings.showAIBadge || !isAI(box)) { aiBadge.style.display = 'none'; return; }
    const r = v.getBoundingClientRect();
    const top = Math.max(8, r.top + 12) + (settings.showBanBtn && curAuthor ? 36 : 0);
    css(aiBadge, { display: 'block', top: top + 'px', left: Math.max(8, r.left + 12) + 'px' });
  };
  const updateBanBtn = v => {
    const box = v && containerOf(v);
    renderBanBtn(v, box);
    updateAIBadge(v, box);
  };
  const renderBanBtn = (v, box) => {
    curAuthor = v ? A.author(box) : null;
    if (!settings.showBanBtn || !v) { if (banBtn) banBtn.style.display = 'none'; return; }
    if (!banBtn) makeBanBtn();
    const au = curAuthor;
    if (!au) { banBtn.style.display = 'none'; return; }
    const r = v.getBoundingClientRect();
    banBtn.textContent = `🚫 แบนช่อง ${au.name}`;
    banBtn.title = `แบน ${au.name} (${au.id}) — คลิปจากช่องนี้จะถูกข้ามอัตโนมัติ`;
    css(banBtn, {
      display: 'block',
      top: Math.max(8, r.top + 12) + 'px',
      left: Math.max(8, r.left + 12) + 'px'
    });
  };

  // ---------- toast ----------
  let toastEl;
  const toast = msg => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      css(toastEl, {
        position: 'fixed', top: '20px', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483647,
        background: 'rgba(0,0,0,.82)', color: '#fff', padding: '8px 16px', borderRadius: '20px',
        font: '14px system-ui,sans-serif', pointerEvents: 'none', transition: 'opacity .3s', opacity: 0
      });
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg; toastEl.style.opacity = 1;
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => (toastEl.style.opacity = 0), 1800);
  };

  setInterval(attach, 500);
})();
