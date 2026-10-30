const $ = id => document.getElementById(id);
const D = { enabled: true, skipAds: true, skipBanned: true, showBanBtn: true, skipAI: false, showAIBadge: true, delay: 300 };
const toggles = ['enabled', 'skipAds', 'skipBanned', 'showBanBtn', 'skipAI', 'showAIBadge'];

chrome.storage.sync.get(D, s => {
  toggles.forEach(k => ($(k).checked = s[k]));
  $('delay').value = s.delay;
});
toggles.forEach(k => ($(k).onchange = e => chrome.storage.sync.set({ [k]: e.target.checked })));
$('delay').onchange = e => chrome.storage.sync.set({ delay: Math.max(0, +e.target.value || 0) });

const render = ({ banned = {}, stats = {} }) => {
  $('ads').textContent = stats.adsSkipped || 0;
  $('bans').textContent = stats.bannedSkipped || 0;
  $('ai').textContent = stats.aiSkipped || 0;
  const items = Object.entries(banned).sort((a, b) => b[1].at - a[1].at);
  $('cnt').textContent = items.length;
  const list = $('list'); list.innerHTML = '';
  if (!items.length) { list.innerHTML = '<div class="empty">ยังไม่มีช่องที่แบน — กดปุ่ม 🚫 บนคลิปเพื่อแบน</div>'; return; }
  for (const [k, b] of items) {
    const row = document.createElement('div'); row.className = 'row';
    const tag = document.createElement('span'); tag.className = 'tag ' + b.site; tag.textContent = b.site === 'tiktok' ? 'TT' : 'FB';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = b.name; name.title = b.id;
    const un = document.createElement('button'); un.textContent = 'ปลดแบน';
    un.onclick = () => chrome.storage.local.get({ banned: {} }, s => { delete s.banned[k]; chrome.storage.local.set({ banned: s.banned }); });
    row.append(tag, name, un); list.append(row);
  }
};
const load = () => chrome.storage.local.get({ banned: {}, stats: {} }, render);
load();
chrome.storage.onChanged.addListener((c, a) => a === 'local' && load());

$('reset').onclick = () => chrome.storage.local.set({ stats: { adsSkipped: 0, bannedSkipped: 0, aiSkipped: 0 } });
$('export').onclick = () => chrome.storage.local.get({ banned: {} }, s => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(s.banned, null, 2)], { type: 'application/json' }));
  a.download = 'banned-channels.json'; a.click();
});
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    chrome.storage.local.get({ banned: {} }, s => chrome.storage.local.set({ banned: { ...s.banned, ...data } }));
  } catch { alert('ไฟล์ไม่ถูกต้อง'); }
};
