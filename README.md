# لوحة مبيعات تفاعلية (React + Vite)

## تشغيل محليًا
1) ثبّت [Node.js LTS](https://nodejs.org/en).
2) في المجلد، شغّل:
```bash
npm i
npm run dev
```
افتح الرابط الذي يظهر في الطرفية.

## نشر مجاني (3 طرق سريعة)

### الطريقة A) Netlify (الأبسط)
1) شغّل البناء:
```bash
npm run build
```
2) ارفعي مجلد `dist/` على Netlify Drop (واجهة السحب والإفلات).
3) سيعطيك رابطًا مباشرًا للموقع.

### الطريقة B) Vercel
1) ارفعي الكود إلى GitHub.
2) ادخلي Vercel > Import Project > اختاري المستودع.
3) Framework: **Vite** – Build Command: `vite build` – Output: `dist`.
4) Deploy.

### الطريقة C) GitHub Pages
1) ادفعي الكود إلى GitHub.
2) استخدمي أي Action جاهز لنشر Vite على Pages، أو أضيفي باكدج `gh-pages`:
```bash
npm i -D gh-pages
```
ثم أضيفي سكريبت للنشر، وشغّلي:
```bash
npm run build
npx gh-pages -d dist
```
