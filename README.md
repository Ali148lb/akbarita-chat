# Akbarita Chat 💬

برنامج دردشة فوري (زي واتساب) — بس باسم مستخدم (username) من دون تسجيل دخول أو كلمة سر.

## المزايا
- اختيار username فريد (ما بيقدر شخصين ياخدو نفس الاسم)
- محادثات فردية (اكتب اسم صاحبك وابلش حكي)
- مجموعات (Groups) — إنشاء مجموعة وإضافة أعضاء بأسمائهم
- إرسال نص، صور 📷، وتسجيلات صوتية 🎤 (Voice notes)
- دعم عربي/انكليزي مع تبديل اتجاه الصفحة (RTL/LTR) بزر واحد
- الرسائل بتنخزن عالسيرفر (ملف data/db.json) — ما بتضيع لما تسكر المتصفح
- شغال Real-time عبر Socket.IO — أي رسالة بتوصل فوراً إذا الطرف الثاني عم يفتح الصفحة

## طريقة التشغيل محليًا
```bash
cd akbarita-chat
npm install
npm start
```
بعدين افتح: `http://localhost:3000`

## نشره عالإنترنت (عشان يوصل لرفاقك من أي مكان)
لازم Node.js يشتغل باستمرار على سيرفر عندو دومين أو IP عام. بدائل سهلة:
1. **Render.com / Railway.app / Fly.io** — بتربط الـ repo وبتنشر تلقائيًا (فيها خطط مجانية محدودة).
2. **VPS خاص فيك** (مثلاً DigitalOcean, Hetzner):
   ```bash
   git clone <your-repo>
   cd akbarita-chat
   npm install
   npm install -g pm2
   pm2 start server.js --name akbarita-chat
   ```
   بعدين حط Nginx كـ reverse proxy قدام البورت 3000 مع شهادة SSL (Let's Encrypt) عشان يشتغل عبر HTTPS (ضروري لميزة تسجيل الصوت بالمتصفح).

⚠️ ميزة التسجيل الصوتي (`getUserMedia`) بتحتاج HTTPS أو `localhost` — ما بتشتغل عبر `http://` عادي عالإنترنت.

## بنية المشروع
```
akbarita-chat/
  server.js        # الباك-إند: Express + Socket.IO + رفع الملفات
  package.json
  public/
    index.html      # الواجهة كاملة (HTML+CSS+JS بملف واحد)
  data/db.json      # قاعدة بيانات بسيطة (مستخدمين + محادثات) — بتنخلق تلقائيًا
  uploads/           # الصور والتسجيلات الصوتية المرفوعة
```

## أفكار لتطوير لاحق
- إشعارات Push (Web Push API) لما يوصل رسالة والتطبيق مسكّر
- حالة "متصل الآن" / "آخر ظهور"
- مؤشر "عم يكتب..."
- تشفير من طرف لطرف (End-to-end encryption)
- الانتقال من JSON file لقاعدة بيانات حقيقية (MongoDB/PostgreSQL) لما يكبر عدد المستخدمين
