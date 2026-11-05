# TalabaMakon — Firebase + Android

OchiqTanlov kabi: sayt Firebase'da doim onlayn ishlaydi (bepul), telefonlar uchun Android ilova (APK) GitHub'da avtomatik yigʻiladi va saytingiz orqali tarqatiladi. Kompyuter yoqiq turishi shart emas.

```
public/              ← sayt (Firebase Hosting)
firestore.rules      ← xavfsizlik: kim nimani koʻradi va oʻzgartiradi
firebase.json        ← hosting sozlamalari, xavfsizlik sarlavhalari
android/             ← Android ilova (WebView)
.github/workflows/   ← APK ni avtomatik yigʻish
```

## 1. Firebase loyihasi (bir marta, ~10 daqiqa)

1. https://console.firebase.google.com → **Add project** → nomi `talabamakon` (Google Analytics shart emas). Tarif — **Spark (bepul)**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**.
3. **Build → Firestore Database → Create database** → **Production mode** → joylashuvni tanlang (keyin oʻzgartirib boʻlmaydi).
4. **Project settings (⚙) → General → Your apps → Web (</>)** → ilova qoʻshing → chiqqan `firebaseConfig` qiymatlarini **`public/firebase-config.js`** fayliga yozing.

## 2. Saytni joylash

Kompyuteringizga [Node.js](https://nodejs.org) oʻrnating, soʻng shu papkada:

```
npm install -g firebase-tools
firebase login
firebase use --add          (roʻyxatdan loyihangizni tanlang)
firebase deploy
```

Oxirida manzil chiqadi: **https://LOYIHA-ID.web.app** — sayt tayyor. `firebase deploy` xavfsizlik qoidalarini ham joylaydi.

## 3. Bosh administrator

1. Saytni oching → **Birinchi hisob** → ism-familiya, login, parol.
2. Sayt koʻrsatgan yoʻl bilan: Firebase Console → **Firestore Database → users →** sizning hujjatingiz → `owner` ni **true**, `status` ni **active** qiling.
3. Saytga qayting — barcha boʻlimlar oʻzi ochiladi.

Bosh administratorni faqat Firebase loyihasi egasi belgilaydi — saytni birinchi ochgan begona odam administrator boʻla olmaydi.

Soʻng: **Maʼlumot yuklash → Namuna maʼlumotni yuklash** (sinov uchun) va **Foydalanuvchilar → Yangi hisob ochish**.

## 4. Android ilova (APK)

1. GitHub'da yangi repozitoriy oching va shu papkani yuklang (`git push`).
2. Repozitoriy → **Settings → Secrets and variables → Actions → Variables → New variable**: nomi `APP_URL`, qiymati `https://LOYIHA-ID.web.app`.
3. **Actions → Android APK → Run workflow**. 3–5 daqiqadan soʻng: oxirgi yigʻish → **Artifacts → TalabaMakon-apk** (zip ichida `TalabaMakon.apk`).
4. APK ni saytdan tarqatish: faylni **`public/TalabaMakon.apk`** qilib qoʻying va `firebase deploy`. Kirish sahifasida **“Android ilovani yuklab olish”** havolasi oʻzi paydo boʻladi (ilovaning oʻzida koʻrinmaydi).
5. Telefonda: faylni oching → “Nomaʼlum manbalardan oʻrnatish”ga ruxsat bering.

### Doimiy imzo kaliti (tavsiya etiladi)

Kalitsiz har safar yangi “debug” APK yigʻiladi va yangi versiyani oʻrnatishdan oldin eskisini oʻchirish kerak boʻladi. Bir marta kalit yarating (Java oʻrnatilgan kompyuterda):

```
keytool -genkeypair -v -keystore talabamakon.jks -alias talabamakon -keyalg RSA -keysize 2048 -validity 10000
```

Soʻng GitHub → **Settings → Secrets → Actions → New repository secret**:

| Nomi | Qiymati |
|---|---|
| `KEYSTORE_B64` | `talabamakon.jks` faylining base64 koʻrinishi (Windows: `certutil -encode talabamakon.jks out.txt`, Linux: `base64 -w0 talabamakon.jks`) |
| `KEYSTORE_PASSWORD` | kalit ombori paroli |
| `KEY_ALIAS` | `talabamakon` |
| `KEY_PASSWORD` | kalit paroli |

`talabamakon.jks` faylini **repozitoriyga yuklamang** va yoʻqotmang — usiz ilovani yangilab boʻlmaydi.

## Xavfsizlik

- Har bir huquq `firestore.rules` da tekshiriladi: tyutor faqat oʻz guruhlarini koʻradi va faqat talabalar turar joyini oʻzgartiradi; tarbiyachi xonalarni oʻzi joriy eta olmaydi; huquq beruvchi oʻziga qoʻshimcha huquq bera olmaydi; bosh administratorga hech kim tega olmaydi.
- `firebase-config.js` dagi kalitlar maxfiy emas (Firebase shunday ishlaydi) — himoya qoidalarda.
- Parolni taxmin qilishga Firebase Auth oʻzi qarshilik qiladi (koʻp urinishdan soʻng vaqtincha bloklaydi).
- Xodim parolini unutsa: Firebase Console → **Authentication** → foydalanuvchini oʻchiring, soʻng saytda unga shu login bilan qayta hisob oching.
- “Jurnal” boʻlimida kim, qachon, nima qilgani koʻrinadi.

## Bepul tarif (Spark) chegaralari

Firestore: kuniga 50 000 oʻqish va 20 000 yozish, 1 GB maʼlumot. Hosting: 1 GB joy, oyiga 10 GB trafik. Sinov va bitta filial uchun yetarli. Chegaraga yetsa, sayt shu kun oxirigacha maʼlumot yozmay qoʻyadi — pul yechilmaydi.

## Muhim: shaxsiy maʼlumotlar

Firestore serverlari Oʻzbekistonda emas. Shuning uchun Firebase'dagi sinovni **namuna maʼlumot** bilan oʻtkazing. Haqiqiy talabalar roʻyxatini yuklashdan oldin tizimni universitet bilan rasman kelishing va maʼlumotlar qayerda saqlanishini hal qiling (zarur boʻlsa — Oʻzbekistondagi server, `DEPLOY.md` yoʻli).
