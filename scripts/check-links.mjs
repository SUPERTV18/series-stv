// فحص روابط الحلقات في ملفات المكتبة، ويرسل تقريرًا (Step Summary + Telegram اختياري).
// يعمل بـ Node 18+ بدون أي مكتبات. يتشغّل من GitHub Actions (انظر .github/workflows/check-links.yml).
import fs from 'node:fs';

const FILES = ['series-arabic.json', 'series-foreign.json', 'series-turkish.json', 'series-korean.json', 'series-ramadan.json', 'movies-arabic.json', 'movies-foreign.json', 'movies-anime.json', 'movies-asian.json', 'programs.json', 'wrestling.json', 'series-indian.json', 'movies-indian.json', 'movies-turkish.json', 'movies-korean.json'];
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
const SLOW_MS = 4000;
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const jobs = [];
for (const file of FILES) {
  if (!fs.existsSync(file)) continue;
  let arr;
  try { arr = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`تعذر قراءة ${file}: ${e.message}`); continue; }
  if (!Array.isArray(arr)) continue;
  for (const s of arr) {
    if (!s || s.hide) continue; // نتجاهل المسلسلات المخفية
    (s.ss || []).forEach((season, si) => {
      (season || []).forEach((ep, ei) => {
        const u = String(ep && ep.u || '').trim();
        if (/^https?:\/\//i.test(u)) jobs.push({ file, title: s.t, season: si + 1, ep: ei + 1, epTitle: ep.t || '', ep_: ep, url: u });
      });
    });
  }
}

async function check(job) {
  const ep = job.ep_;
  const headers = { 'User-Agent': ep.ua || DEFAULT_UA, 'Range': 'bytes=0-1023', 'Accept': '*/*' };
  if (ep.ref) headers['Referer'] = ep.ref;
  if (ep.cookie) headers['Cookie'] = ep.cookie;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(job.url, { headers, signal: ctl.signal, redirect: 'follow' });
    const ms = Date.now() - t0;
    try { await res.body?.cancel(); } catch {}
    if (res.ok || res.status === 206) return { s: ms > SLOW_MS ? 'slow' : 'ok', code: res.status, ms };
    if ([401, 403, 429].includes(res.status)) return { s: 'blocked', code: res.status, ms };
    return { s: 'bad', code: res.status, ms };
  } catch (e) {
    return { s: 'bad', code: ctl.signal.aborted ? 'timeout' : 'network', ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

let next = 0;
const results = new Array(jobs.length);
async function worker() {
  while (next < jobs.length) {
    const i = next++;
    results[i] = await check(jobs[i]);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const bad = [], slow = [], blocked = [];
let ok = 0;
jobs.forEach((j, i) => {
  const r = results[i];
  const row = { ...j, ...r };
  if (r.s === 'ok') ok++;
  else if (r.s === 'slow') slow.push(row);
  else if (r.s === 'blocked') blocked.push(row);
  else bad.push(row);
});

const line = (r) => `- ${r.file.replace('series-', '').replace('.json', '')} · **${r.title}** · موسم ${r.season} حلقة ${r.ep} — \`${r.code}\``;
let md = `# تقرير فحص الروابط\n\nتم فحص ${jobs.length} رابط: ✅ ${ok} يعمل · 🐢 ${slow.length} بطيء · 🔒 ${blocked.length} محجوب (401/403/429) · ❌ ${bad.length} لا يعمل.\n\n`;
md += '> ملاحظة: الفحص من خوادم GitHub (أمريكا). بعض المصادر بتحجب هذه العناوين أو تقيّد الدولة، فاعتبر «المحجوب» مشتبهًا فيه مش مؤكد.\n\n';
if (bad.length) md += `## ❌ لا يعمل\n${bad.map(line).join('\n')}\n\n`;
if (blocked.length) md += `## 🔒 محجوب / مشتبه\n${blocked.slice(0, 50).map(line).join('\n')}${blocked.length > 50 ? `\n- و${blocked.length - 50} آخرين` : ''}\n\n`;
if (slow.length) md += `## 🐢 بطيء\n${slow.slice(0, 30).map(line).join('\n')}\n`;

fs.writeFileSync('link-report.md', md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
console.log(md);

const tgToken = process.env.TELEGRAM_BOT_TOKEN, tgChat = process.env.TELEGRAM_CHAT_ID;
if (tgToken && tgChat && bad.length) {
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ '<': '\x26lt;', '>': '\x26gt;', '&': '\x26amp;' }[c]));
  let text = `⚠️ فحص الروابط: ${bad.length} رابط لا يعمل من ${jobs.length}\n\n` +
    bad.slice(0, 25).map((r) => `• <b>${esc(r.title)}</b> م${r.season} ح${r.ep} (${r.code})`).join('\n');
  if (bad.length > 25) text += `\nو${bad.length - 25} آخرين…`;
  try {
    const res = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: tgChat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (!res.ok) console.error('Telegram HTTP ' + res.status);
  } catch (e) { console.error('Telegram: ' + e.message); }
}
