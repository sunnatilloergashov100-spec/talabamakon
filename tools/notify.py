#!/usr/bin/env python3
"""TalabaMakon — Telegram xabarnomalari.

GitHub Actions har 10 daqiqada ishga tushiradi (.github/workflows/notify.yml). Bepul: server kerak emas.
Kerakli GitHub Secrets:
  FIREBASE_SERVICE_ACCOUNT  — Firebase Console → Project settings → Service accounts → Generate new private key (JSON matni)
  TELEGRAM_BOT_TOKEN        — @BotFather bergan token

Nima qiladi:
  1. Botga kelgan kodlarni oʻqib, foydalanuvchini Telegram chatiga bogʻlaydi (tglink/{uid}.chatId).
  2. Harakatlar jurnalidagi yangi yozuvlar boʻyicha xabar yuboradi:
       yangi kirish soʻrovi → huquq beruvchilarga
       xonalar tasdiqqa yuborildi → tasdiqlovchilarga
       xonalar tasdiqlandi / rad etildi → oʻsha yotoqxona tarbiyachisiga
  3. Kuniga bir marta (09:00 dan keyin): 3 kun ketma-ket sababsiz yoʻq TTJ talabalari →
       tarbiyachi, talabaning tyutori va butun filial statistikasini koʻruvchilarga.
"""
import html
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

TZ = timezone(timedelta(hours=5))  # Toshkent vaqti
SITE = os.environ.get("SITE_URL", "https://talabamakon.web.app").rstrip("/")
DAILY_HOUR = 9
E = html.escape


# ---------------------------------------------------------------- Telegram
def make_tg(token):
    def tg(method, **params):
        data = urllib.parse.urlencode({k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in params.items()}).encode()
        req = urllib.request.Request(f"https://api.telegram.org/bot{token}/{method}", data=data)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="ignore")
            print(f"Telegram {method}: {e.code} {body[:200]}")
            return {"ok": False, "description": body}
        except OSError as e:
            print(f"Telegram {method}: {e}")
            return {"ok": False}
    return tg


# ---------------------------------------------------------------- logic (Firestore and Telegram are passed in, so it can be tested)
def run(db, tg, now=None, delete_field=None):
    now = now or datetime.now(timezone.utc)
    local = now.astimezone(TZ)
    st_ref = db.document("notify/state")
    st = st_ref.get().to_dict() or {}
    users = {d.id: d.to_dict() for d in db.collection("users").stream()}
    links = {d.id: d.to_dict() for d in db.collection("tglink").stream()}
    outbox = {}  # uid -> [matn, ...]

    def active(u):
        return bool(u.get("owner")) or u.get("status") == "active"

    def who(pred, owner=True):
        return [uid for uid, u in users.items() if active(u) and ((owner and u.get("owner")) or pred(u.get("perms") or {}))]

    def queue(uids, text, skip=None):
        for uid in set(uids):
            if uid != skip:
                outbox.setdefault(uid, [])
                if text not in outbox[uid]:
                    outbox[uid].append(text)

    def send(chat_id, text):
        r = tg("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML", disable_web_page_preview="true")
        time.sleep(0.04)
        return bool(r.get("ok"))

    # 1) bot messages → link accounts
    offset = int(st.get("tgOffset") or 0)
    upd = tg("getUpdates", offset=offset, timeout=0, allowed_updates=["message"])
    linked = 0
    for u in upd.get("result", []) or []:
        offset = max(offset, int(u["update_id"]) + 1)
        m = u.get("message") or {}
        chat = m.get("chat") or {}
        text = (m.get("text") or "").strip()
        if chat.get("type") != "private" or not text:
            continue
        words = text.split()
        if words[0] == "/start" and len(words) == 1 or words[0] in ("/help", "/yordam"):
            send(chat["id"], "Assalomu alaykum! Bu <b>TalabaMakon</b> xabarnomalari boti.\n\n"
                             f"Ulanish uchun saytda: <b>Profil → Telegram xabarnomalar → Kod olish</b> ni bosing.\n{SITE}")
            continue
        code = words[-1].strip().upper()
        uid = next((k for k, v in links.items() if v.get("code") and v.get("code") == code), None)
        if not uid or uid not in users or not active(users[uid]):
            send(chat["id"], "Kod topilmadi yoki eskirgan. Saytdan yangi kod oling: <b>Profil → Telegram xabarnomalar</b>.")
            continue
        at = links[uid].get("at") or ""
        try:
            fresh = now - datetime.fromisoformat(at.replace("Z", "+00:00")) < timedelta(days=2)
        except ValueError:
            fresh = False
        if not fresh:
            send(chat["id"], "Bu kodning muddati oʻtgan. Saytdan yangi kod oling.")
            continue
        frm = m.get("from") or {}
        tg_name = ("@" + frm["username"]) if frm.get("username") else " ".join(x for x in (frm.get("first_name"), frm.get("last_name")) if x)
        patch = {"chatId": chat["id"], "tgName": tg_name, "linkedAt": now.isoformat()}
        patch["code"] = delete_field if delete_field is not None else None
        db.document(f"tglink/{uid}").set(patch, merge=True)
        links[uid].update(chatId=chat["id"], code=None)
        linked += 1
        send(chat["id"], f"✅ Ulandingiz: <b>{E(users[uid].get('name', ''))}</b>.\nEndi TalabaMakon xabarnomalari shu yerga keladi.")
    st["tgOffset"] = offset

    # 2) audit log events since the last run
    cursor = st.get("auditCursor")
    events = 0
    if not cursor:
        st["auditCursor"] = now.isoformat()  # birinchi ishga tushishda eski yozuvlar uchun xabar yuborilmaydi
    else:
        dorms_by_name = None
        for d in db.collection("audit").where("at", ">", cursor).order_by("at").limit(300).stream():
            a = d.to_dict()
            cursor = max(cursor, a.get("at") or cursor)
            act, actor = a.get("action"), users.get(a.get("uid"), {})
            name = E(actor.get("name", ""))
            if act == "register":
                events += 1
                queue(who(lambda p: p.get("users")), f"🆕 <b>Yangi kirish soʻrovi</b>\n{name} (login: {E(actor.get('username', ''))})\nHuquq berish: {SITE} → Boshqaruv → Foydalanuvchilar")
            elif act in ("dorm-submit", "dorm-approve", "dorm-reject"):
                if dorms_by_name is None:
                    dorms_by_name = {}
                    for x in db.collection("dorms").stream():
                        dorms_by_name[x.to_dict().get("name")] = (x.id, x.to_dict())
                did, dm = dorms_by_name.get(a.get("detail"), (None, {}))
                if not did:
                    continue
                dn = E(dm.get("name", ""))
                if act == "dorm-submit" and (dm.get("draft") or {}).get("status") == "pending":
                    events += 1
                    queue(who(lambda p: p.get("approve")), f"🏠 <b>{dn}</b>: qavat va xonalar boʻyicha oʻzgarish tasdigʻingizni kutmoqda.\nYubordi: {name}\n{SITE} → Boshqaruv → Tasdiqlash", skip=a.get("uid"))
                elif act == "dorm-approve":
                    events += 1
                    queue(who(lambda p, did=did: p.get("dorm") and did in (p.get("dorms") or []), owner=False), f"✅ <b>{dn}</b>: xonalar boʻyicha oʻzgarishlaringiz tasdiqlandi va joriy etildi.\nTasdiqladi: {name}", skip=a.get("uid"))
                elif act == "dorm-reject":
                    events += 1
                    note = E((dm.get("draft") or {}).get("note") or "")
                    queue(who(lambda p, did=did: p.get("dorm") and did in (p.get("dorms") or []), owner=False), f"❌ <b>{dn}</b>: xonalar boʻyicha oʻzgarishlaringiz rad etildi.\nSabab: {note or '—'}\nRad etdi: {name}", skip=a.get("uid"))
        st["auditCursor"] = cursor

    # 3) once a day: 3 days in a row absent without reason
    today = local.date().isoformat()
    streaks = 0
    if local.hour >= DAILY_HOUR and st.get("streakDay") != today:
        days = [(local.date() - timedelta(days=i)).isoformat() for i in (3, 2, 1)]  # oxirgi 3 ta toʻliq kun
        groups = {d.id: d.to_dict() for d in db.collection("groups").stream()}
        stud = {s["id"]: (gid, s) for gid, g in groups.items() for s in g.get("students", [])}
        att = {d.id: d.to_dict() for d in db.collection("att").where("date", ">=", days[0]).stream()}
        for d in db.collection("dorms").stream():
            did, dm = d.id, d.to_dict()
            hits = [sid for sid in (dm.get("assign") or {}) if sid in stud and all(
                ((att.get(f"{did}_{day}") or {}).get("marks") or {}).get(sid) == "sababsiz" for day in days)]
            if not hits:
                continue
            streaks += len(hits)
            by_group, lines = {}, []
            for sid in hits:
                gid, s = stud[sid]
                g = groups.get(gid, {})
                lines.append(f"• {E(s.get('n', ''))} — {E(g.get('name', ''))}, {E(g.get('fac', ''))}")
                by_group.setdefault(gid, []).append(s.get("n", ""))
            period = f"{days[0][8:]}.{days[0][5:7]}–{days[-1][8:]}.{days[-1][5:7]}"
            queue(who(lambda p, did=did: (p.get("dorm") and did in (p.get("dorms") or [])) or p.get("stat_all")),
                  f"⚠️ <b>{E(dm.get('name', ''))}</b>: 3 kun ketma-ket sababsiz yoʻq ({period})\n" + "\n".join(lines))
            for gid, names in by_group.items():
                g = groups.get(gid, {})
                queue(who(lambda p, gid=gid: p.get("grp") and gid in (p.get("groups") or []), owner=False),
                      f"⚠️ Guruhingiz (<b>{E(g.get('name', ''))}</b>) talabasi {E(dm.get('name', ''))}da 3 kun ketma-ket sababsiz yoʻq ({period}):\n"
                      + "\n".join("• " + E(n) for n in names))
        st["streakDay"] = today

    # send
    sent = 0
    for uid, texts in outbox.items():
        chat_id = (links.get(uid) or {}).get("chatId")
        if not chat_id:
            continue
        for t in texts:
            sent += send(chat_id, t)
    st["lastRun"] = now.isoformat()
    st_ref.set(st, merge=True)
    print(f"Ulandi: {linked}, hodisalar: {events}, 3 kunlik: {streaks}, yuborildi: {sent}")
    return {"linked": linked, "events": events, "streaks": streaks, "sent": sent, "outbox": outbox}


def main():
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    sa = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not token or not sa:
        print("TELEGRAM_BOT_TOKEN yoki FIREBASE_SERVICE_ACCOUNT berilmagan — oʻtkazib yuborildi.")
        return
    import firebase_admin
    from firebase_admin import credentials, firestore
    firebase_admin.initialize_app(credentials.Certificate(json.loads(sa)))
    run(firestore.client(), make_tg(token), delete_field=firestore.DELETE_FIELD)


if __name__ == "__main__":
    main()
