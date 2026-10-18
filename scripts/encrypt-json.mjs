// يشفّر ملفات الـ JSON ويكتب النتيجة في dist/ (اللي Cloudflare Pages بينشره). الأصل في المستودع بيفضل عادي.
// Pages: Build command = node scripts/encrypt-json.mjs   |   Build output directory = dist   |   متغير البيئة DATA_KEY = نفس المفتاح اللي في الصفحات
import fs from 'node:fs';
import crypto from 'node:crypto';

const KEY = process.env.DATA_KEY;
if (!KEY) { console.error('DATA_KEY مش متظبط في Environment variables'); process.exit(1); }

function xmur3(str){for(var i=0,h=1779033703^str.length;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19}return function(){h=Math.imul(h^h>>>16,2246822507);h=Math.imul(h^h>>>13,3266489909);return(h^=h>>>16)>>>0}}
function sfc32(a,b,c,d){return function(){a>>>=0;b>>>=0;c>>>=0;d>>>=0;var t=(a+b)|0;a=b^b>>>9;b=c+(c<<3)|0;c=(c<<21|c>>>11);d=d+1|0;t=t+d|0;c=c+t|0;return t>>>0}}
function keystream(key,nonce){var s=xmur3(key+':'+nonce),g=sfc32(s(),s(),s(),s()),buf=0,left=0;for(var i=0;i<12;i++)g();return function(){if(!left){buf=g();left=4}left--;var b=buf&255;buf>>>=8;return b}}

const ENCRYPT = ['series-arabic.json','series-foreign.json','series-turkish.json','series-korean.json','series-ramadan.json',
                 'movies-arabic.json','movies-foreign.json','movies-anime.json','movies-asian.json'];
const PLAIN = ['ad-settings.json'];            // بتتنسخ زي ما هي
fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

for (const f of ENCRYPT) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f);
  JSON.parse(raw.toString('utf8'));            // نتأكد إنه JSON سليم قبل التشفير
  const nonce = crypto.randomBytes(6).toString('hex');
  const ks = keystream(KEY, nonce), out = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw[i] ^ ks();
  fs.writeFileSync('dist/' + f, JSON.stringify({ v: 1, n: nonce, d: out.toString('base64') }));
  console.log('مشفّر:', f, raw.length, 'بايت');
}
for (const f of PLAIN) if (fs.existsSync(f)) { fs.copyFileSync(f, 'dist/' + f); console.log('منسوخ:', f); }
if (fs.existsSync('_headers')) fs.copyFileSync('_headers', 'dist/_headers');
else fs.writeFileSync('dist/_headers', '/*.json\n  Access-Control-Allow-Origin: *\n  Cache-Control: public, max-age=60, must-revalidate\n');
fs.writeFileSync('dist/index.html', '<!doctype html><meta charset="utf-8"><title>.</title>');
