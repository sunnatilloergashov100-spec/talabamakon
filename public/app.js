(() => {
"use strict";
const $app = document.getElementById("app");
const $toast = document.getElementById("toast");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const store = {
  get(k){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k,v){ try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};

const TYPES = [
  {k:"TTJ", l:"TTJ (yotoqxona)", s:"TTJ", v:"--ttj"},
  {k:"Ijara", l:"Ijara xonadon", s:"Ijara", v:"--ijara"},
  {k:"Uy", l:"Oʻz uyidan qatnaydi", s:"Oʻz uyi", v:"--uy"},
  {k:"Qarindosh", l:"Qarindoshinikida", s:"Qarindosh", v:"--qar"},
  {k:"", l:"Kiritilmagan", s:"Kiritilmagan", v:"--none"}
];
const TL = Object.fromEntries(TYPES.map(t => [t.k, t]));
const ATT = [
  {k:"bor", l:"Bor", v:"--good"},
  {k:"uy", l:"Uyga ketgan", v:"--ttj"},
  {k:"ruxsat", l:"Ruxsat bilan", v:"--warn"},
  {k:"kasal", l:"Kasal", v:"--qar"},
  {k:"sababsiz", l:"Sababsiz", v:"--bad"}
];
const PERMS = [
  {k:"stat_all", l:"Butun filial statistikasini koʻrish", d:"Umumiy holat, fakultetlar, tyutorlar, yotoqxonalar va talabalar roʻyxati"},
  {k:"stat_fac", l:"Fakultet statistikasini koʻrish", d:"Faqat quyida belgilangan fakultet(lar) boʻyicha", scope:"facs"},
  {k:"grp", l:"Guruhlar talabalarining turar joyini kiritish", d:"Faqat quyida belgilangan guruhlar", scope:"groups"},
  {k:"dorm", l:"Yotoqxonani boshqarish", d:"Qavat va xona qoʻshish (tasdiqdan keyin joriy etiladi), joylashtirish, kunlik yoʻqlama", scope:"dorms"},
  {k:"struct", l:"Tuzilmani boshqarish", d:"Fakultet, guruh, yotoqxona qoʻshish va guruhga tyutor biriktirish"},
  {k:"approve", l:"Yotoqxona oʻzgarishlarini tasdiqlash", d:"Tarbiyachi qoʻshgan qavat va xonalarni koʻrib chiqish, joriy etish yoki rad etish"},
  {k:"import", l:"Maʼlumot yuklash", d:"Excel'dan talabalar va xonalarni yuklash, bazani tozalash"},
  {k:"users", l:"Foydalanuvchilar va huquqlar", d:"Hisob ochish, kirish soʻrovlarini koʻrib chiqish, huquq berish va olib qoʻyish"}
];
const GL = {Q:"Qiz", O:"Oʻgʻil"};

const pad = n => String(n).padStart(2,"0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const dayShift = k => { const d = new Date(); d.setDate(d.getDate()+k); return ymd(d); };
let TODAY = ymd(new Date());
let DAYS3 = [dayShift(-2), dayShift(-1), TODAY];
const fmtDate = iso => { if(!iso) return "—"; const d = new Date(iso); return isNaN(d) ? "—" : `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; };
const pct = (a,b) => b ? Math.round(a/b*1000)/10 : 0;
const norm = s => String(s ?? "").toLowerCase().replace(/[ʻʼ'‘’`´ʹ]/g,"").replace(/\s+/g," ").trim();
const hash = s => { let h = 5381; for (const c of String(s)) h = ((h<<5) + h + c.charCodeAt(0)) >>> 0; return h.toString(36); };

/* ---------------- state ---------------- */
const S = {
  auth:null, loaded:false, offline:false, canWrite:true,
  me:{id:null, owner:false, name:""}, perms:null,
  org:null, groups:new Map(), dorms:new Map(), att:new Map(), staff:new Map(), requests:new Map(),
  tutors:{}, dormStaff:{}, facList:[], people:[],
  tab: store.get("tm_tab") || "",
  f: {branch:"", fac:"", course:"", g:"", rt:""},
  q:"", limit:100, openGroup:null, openRoom:null, dormTab:"xonalar", curDorm: store.get("tm_dorm") || "",
  imp:null, confirm:"", busy:"", edit:null, editErr:"",
  gate:"login", form:{name:"", username:"", password:""}, formErr:"",
  draft:null, draftDorm:null, newRoom:{fl:"", no:"", cap:"4", g:""}, structFac:"", decideNote:{},
  settings:null, pwOpen:false, pw:{old:"", n1:"", n2:""}, pwErr:"", audit:null
};

function toast(msg){ $toast.textContent = msg; $toast.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => $toast.hidden = true, 3500); }

/* ---------------- Firebase ---------------- */
// Server oʻrnida Firebase: kirish — Firebase Auth, maʼlumotlar — Firestore (jonli yangilanadi).
// Har bir huquq firestore.rules da tekshiriladi; bu yerdagi tekshiruvlar faqat qulay xabarlar uchun.
const FB = {ok:false, auth:null, db:null, uid:null, unsubMe:null, unsubData:[], dataKey:"", pub:null, parts:{}};
const LOGIN_DOMAIN = "talabamakon.app";
const toEmail = u => `${String(u || "").trim().toLowerCase()}@${LOGIN_DOMAIN}`;
const nowIso = () => new Date().toISOString();
const E = (status, error) => ({status, error});
function fbErr(e){
  if (e && e.status !== undefined && e.error) return e;
  const c = (e && e.code) || "";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login-credentials|invalid-email/.test(c)) return E(400, "Login yoki parol notoʻgʻri.");
  if (c.includes("too-many-requests")) return E(429, "Juda koʻp urinish. Birozdan soʻng qayta urining.");
  if (c.includes("email-already-in-use")) return E(400, "Bu login band. Boshqasini tanlang.");
  if (c.includes("weak-password")) return E(400, "Parol juda oddiy.");
  if (c.includes("requires-recent-login")) return E(401, "Xavfsizlik uchun qayta kiring.");
  if (c.includes("network-request-failed") || c === "unavailable") return E(0, "Internet bilan aloqa yoʻq.");
  if (c === "permission-denied") return E(403, "Bu amal uchun huquqingiz yoʻq.");
  if (c === "not-found") return E(404, "Maʼlumot topilmadi.");
  return E(500, "Xato yuz berdi" + (c ? ` (${c})` : "") + ".");
}
function cleanUsername(u){
  u = String(u || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(u)) throw E(400, "Login 3–40 belgidan iborat boʻlsin: lotin harflari, raqamlar, nuqta, tire.");
  return u;
}
function checkPw(pw, username){
  pw = pw || "";
  if (pw.length < 8 || pw.length > 128) throw E(400, "Parol kamida 8 belgidan iborat boʻlsin.");
  if (!/[A-Za-zА-Яа-яЁё]/.test(pw) || !/\d/.test(pw)) throw E(400, "Parolda kamida bitta harf va bitta raqam boʻlsin.");
  if (username && pw.toLowerCase().includes(username.toLowerCase())) throw E(400, "Parolda login boʻlmasin.");
  if (["password1","parol123","qwerty123","12345678a","admin123","talaba123"].includes(pw.toLowerCase())) throw E(400, "Bu parol juda oddiy. Boshqasini tanlang.");
}
const cleanName = n => { n = String(n || "").split(/\s+/).filter(Boolean).join(" ").slice(0, 80); if (n.split(" ").length < 2) throw E(400, "Ism va familiyani toʻliq yozing."); return n; };
const col = name => FB.db.collection(name);
function log(action, detail){
  const uid = FB.auth && FB.auth.currentUser && FB.auth.currentUser.uid;
  if (!uid) return;
  col("audit").add({uid, action, detail:String(detail || "").slice(0, 500), at:nowIso()}).catch(() => {});
}
const PERM_FLAGS = ["stat_all","stat_fac","grp","dorm","struct","approve","import","users"];
function permsFromDoc(d){
  if (!d) return null;
  if (d.owner) return {owner:true, stat_all:true, stat_fac:false, facs:[], grp:false, groups:[], dorm:true, dorms:[...S.dorms.keys()], import:true, users:true, struct:true, approve:true};
  const p = d.perms || {};
  return {owner:false, stat_all:!!p.stat_all, stat_fac:!!p.stat_fac, facs:p.stat_fac ? (p.facs || []) : [], grp:!!p.grp, groups:p.grp ? (p.groups || []) : [],
    dorm:!!p.dorm, dorms:p.dorm ? (p.dorms || []) : [], import:!!p.import, users:!!p.users, struct:!!p.struct, approve:!!p.approve};
}

/* who am I, and what may I see */
function setAuthState(){
  const needOwner = !(FB.pub && FB.pub.hasOwner);
  const allowRegister = !FB.pub || FB.pub.allowRegister !== false;
  if (!FB.uid){ S.auth = {auth:false, needOwner, allowRegister}; if (needOwner && S.gate === "login") S.gate = "setup"; return; }
  const d = FB.meDoc;
  if (d === undefined){ S.auth = null; return; }
  const status = !d ? "none" : (d.owner || d.status === "active") ? "active" : "pending";
  S.auth = {auth:true, status, needOwner, allowRegister};
  S.me = {id:FB.uid, name:d ? d.name : "", username:d ? d.username : FB.username, owner:!!(d && d.owner)};
}
function detachData(){ for (const u of FB.unsubData) try { u(); } catch {} FB.unsubData = []; FB.dataKey = ""; FB.parts = {}; S.loaded = false; }
function watchDoc(ref, fn){ FB.unsubData.push(ref.onSnapshot(fn, e => { console.warn(e); if (e.code === "permission-denied") return; S.offline = true; renderSoon(); })); }
function mergeGroups(){
  const m = new Map();
  for (const part of Object.values(FB.parts)) for (const [k, v] of part) m.set(k, v);
  S.groups = m;
}
function attachData(){
  const p = permsFromDoc(FB.meDoc);
  const key = JSON.stringify(p);
  if (key === FB.dataKey) return;
  detachData();
  FB.dataKey = key;
  S.perms = p;
  const seen = new Set();
  const done = k => { seen.add(k); if (seen.has("groups") && seen.has("dorms")){ S.loaded = true; S.offline = false; } renderSoon(); };
  const db = FB.db;
  watchDoc(db.doc("meta/org"), s => { S.org = s.exists ? s.data() : null; done("org"); });
  watchDoc(db.doc("meta/facs"), s => { S.facList = (s.exists && s.data().list) || []; done("facs"); });
  watchDoc(col("dorms"), s => {
    const m = new Map(); s.forEach(d => m.set(d.id, {id:d.id, ...d.data()})); S.dorms = m;
    if (S.perms && S.perms.owner) S.perms.dorms = [...m.keys()];
    done("dorms");
  });
  watchDoc(col("att").where("date", ">=", DAYS3[0]), s => { const m = new Map(); s.forEach(d => m.set(d.id, {id:d.id, ...d.data()})); S.att = m; done("att"); });
  const broad = p.owner || p.stat_all || p.dorm || p.struct || p.import || p.users;
  const toMap = s => { const m = new Map(); s.forEach(d => m.set(d.id, {id:d.id, ...d.data()})); return m; };
  if (broad) watchDoc(col("groups"), s => { FB.parts.all = toMap(s); mergeGroups(); done("groups"); });
  else {
    let pending = 0;
    if (p.stat_fac && p.facs.length) for (let i = 0; i < p.facs.length; i += 30){
      const chunk = p.facs.slice(i, i + 30), k = "fac" + i; pending++;
      watchDoc(col("groups").where("fac", "in", chunk), s => { FB.parts[k] = toMap(s); mergeGroups(); done("groups"); });
    }
    for (const gid of p.groups){
      pending++;
      watchDoc(db.doc("groups/" + gid), s => { FB.parts["g_" + gid] = s.exists ? new Map([[gid, {id:gid, ...s.data()}]]) : new Map(); mergeGroups(); done("groups"); });
    }
    if (!pending){ S.groups = new Map(); done("groups"); }
  }
  if (p.users) watchDoc(col("users"), s => {
    const staff = new Map(), req = new Map(), people = [], tutors = {}, dstaff = {};
    s.forEach(d => {
      const u = {id:d.id, ...d.data()};
      if (u.owner) return;
      const flat = {id:u.id, name:u.name, username:u.username, at:u.updated || u.created, ...(u.perms || {})};
      if (u.status === "active"){
        staff.set(u.id, flat); people.push({id:u.id, name:u.name});
        if (flat.grp) for (const g of (flat.groups || [])) (tutors[g] ||= []).push(u.name);
        if (flat.dorm) for (const x of (flat.dorms || [])) (dstaff[x] ||= []).push(u.name);
      } else req.set(u.id, flat);
    });
    S.staff = staff; S.requests = req; S.people = people; S.tutors = tutors; S.dormStaff = dstaff;
    renderSoon();
  });
  else { S.staff = new Map(); S.requests = new Map(); S.people = []; S.tutors = {}; S.dormStaff = {}; }
  S.settings = p.users ? {allowRegister: !FB.pub || FB.pub.allowRegister !== false} : null;
  // bosh administrator birinchi marta kirganda: kirish sahifasi uchun ochiq sozlama
  if (p.owner && !(FB.pub && FB.pub.hasOwner)) db.doc("meta/public").set({hasOwner:true, allowRegister:FB.pub ? FB.pub.allowRegister !== false : true}, {merge:true}).catch(() => {});
}
function onMeDoc(snap){
  FB.meDoc = snap.exists ? snap.data() : null;
  setAuthState();
  if (S.auth && S.auth.status === "active") attachData(); else { detachData(); S.perms = null; }
  renderSoon();
}

function initFirebase(){
  const cfg = window.TALABAMAKON_FIREBASE;
  if (typeof firebase === "undefined" || !cfg || !cfg.apiKey || cfg.apiKey.startsWith("BU_YERGA")){
    S.auth = null; S.offline = true; S.fbMissing = true; render(); return;
  }
  firebase.initializeApp(cfg);
  FB.auth = firebase.auth();
  FB.db = firebase.firestore();
  FB.ok = true;
  FB.db.doc("meta/public").onSnapshot(s => {
    FB.pub = s.exists ? s.data() : null;
    if (S.settings) S.settings.allowRegister = !FB.pub || FB.pub.allowRegister !== false;
    setAuthState(); renderSoon();
  }, () => { FB.pub = null; setAuthState(); renderSoon(); });
  FB.auth.onAuthStateChanged(user => {
    if (FB.unsubMe){ FB.unsubMe(); FB.unsubMe = null; }
    detachData();
    FB.uid = user ? user.uid : null;
    FB.username = user && user.email ? user.email.split("@")[0] : "";
    FB.meDoc = undefined;
    setAuthState(); render();
    if (user) FB.unsubMe = FB.db.doc("users/" + user.uid).onSnapshot(onMeDoc, () => { FB.meDoc = null; setAuthState(); render(); });
  });
}

/* every action the page performs — same names as the old server routes */
const tx = fn => FB.db.runTransaction(fn);
const API = {
  async "/api/register"(b){
    const name = cleanName(b.name), username = cleanUsername(b.username);
    checkPw(b.password, username);
    if (FB.pub && FB.pub.hasOwner && FB.pub.allowRegister === false) throw E(403, "Hisoblarni administrator ochadi. Unga murojaat qiling.");
    const cred = await FB.auth.createUserWithEmailAndPassword(toEmail(username), b.password);
    try {
      await FB.db.doc("users/" + cred.user.uid).set({name, username, status:"pending", owner:false, perms:{}, created:nowIso()});
    } catch (e){ try { await cred.user.delete(); } catch {} throw E(403, "Soʻrov qabul qilinmadi. Hisoblarni administrator ochadi."); }
    log("register", username);
    return {ok:true};
  },
  async "/api/rerequest"(b){
    const name = cleanName(b.name);
    await FB.db.doc("users/" + FB.uid).set({name, username:FB.username, status:"pending", owner:false, perms:{}, created:nowIso()});
    log("register", FB.username);
    return {ok:true};
  },
  async "/api/login"(b){
    const username = String(b.username || "").trim().toLowerCase();
    await FB.auth.signInWithEmailAndPassword(toEmail(username), b.password || "");
    log("login", navigator.userAgent.includes("TalabaMakonApp") ? "Android ilova" : "brauzer");
    return {ok:true};
  },
  async "/api/logout"(){ await FB.auth.signOut(); return {ok:true}; },
  async "/api/cancelreq"(){
    const u = FB.auth.currentUser;
    await FB.db.doc("users/" + u.uid).delete().catch(() => {});
    try { await u.delete(); } catch { await FB.auth.signOut(); }
    return {ok:true};
  },
  async "/api/password"(b){
    const u = FB.auth.currentUser;
    if (b.new === b.old) throw E(400, "Yangi parol eskisidan farq qilsin.");
    checkPw(b.new, S.me.username);
    try { await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, b.old || "")); }
    catch (e){ throw fbErr(e).status === 400 ? E(400, "Joriy parol notoʻgʻri.") : fbErr(e); }
    await u.updatePassword(b.new);
    log("password", "");
    return {ok:true};
  },
  async "/api/student"(b){
    const ref = FB.db.doc("groups/" + b.gid);
    const patch = {};
    if ("rt" in b.patch){ if (!["","TTJ","Ijara","Uy","Qarindosh"].includes(b.patch.rt)) throw E(400, "Turar joy turi notoʻgʻri."); patch.rt = b.patch.rt; }
    if ("ra" in b.patch) patch.ra = String(b.patch.ra).slice(0, 200);
    await tx(async t => {
      const s = await t.get(ref); if (!s.exists) throw E(404, "Guruh topilmadi.");
      let found = false;
      const students = (s.data().students || []).map(x => x.id === b.sid ? (found = true, {...x, ...patch, up:nowIso()}) : x);
      if (!found) throw E(404, "Talaba topilmadi.");
      t.update(ref, {students, updatedAt:nowIso()});
    });
    log("student", `${b.gid}/${b.sid} ${JSON.stringify(patch)}`);
    return {ok:true};
  },
  async "/api/assign"(b){
    const ref = FB.db.doc("dorms/" + b.did);
    await tx(async t => {
      const s = await t.get(ref); if (!s.exists) throw E(404, "Yotoqxona topilmadi.");
      const d = s.data(), assign = {...(d.assign || {})};
      if (b.rid){
        const room = (d.rooms || []).find(r => r.id === b.rid); if (!room) throw E(404, "Xona topilmadi.");
        const used = Object.entries(assign).filter(([k, v]) => v === b.rid && k !== b.sid).length;
        if (used >= (+room.cap || 0)) throw E(400, "Xona toʻla.");
        assign[b.sid] = b.rid;
      } else delete assign[b.sid];
      t.update(ref, {assign});
    });
    log("assign", `${b.did} ${b.sid} -> ${b.rid || "chiqarildi"}`);
    return {ok:true};
  },
  async "/api/att"(b){
    const ref = FB.db.doc(`att/${b.did}_${TODAY}`);
    await tx(async t => {
      const s = await t.get(ref);
      const marks = {...((s.exists && s.data().marks) || {})};
      if (b.st) marks[b.sid] = b.st; else delete marks[b.sid];
      t.set(ref, {dorm:b.did, date:TODAY, marks});
    });
    return {ok:true};
  },
  async "/api/allbor"(b){
    const dref = FB.db.doc("dorms/" + b.did), ref = FB.db.doc(`att/${b.did}_${TODAY}`);
    await tx(async t => {
      const d = await t.get(dref), s = await t.get(ref);
      const marks = {...((s.exists && s.data().marks) || {})};
      for (const sid of Object.keys((d.exists && d.data().assign) || {})) if (!marks[sid]) marks[sid] = "bor";
      t.set(ref, {dorm:b.did, date:TODAY, marks});
    });
    log("allbor", b.did);
    return {ok:true};
  },
  async "/api/replace"(b){
    const ops = [];
    for (const c of ["groups","dorms","att"]){ const s = await col(c).get(); s.forEach(d => ops.push(["del", d.ref])); }
    let n = 0;
    for (const g of b.groups){ const {id, ...body} = g; n += (body.students || []).length; ops.push(["set", FB.db.doc("groups/" + id), body]); }
    for (const d of b.dorms){ const {id, ...body} = d; ops.push(["set", FB.db.doc("dorms/" + id), {draft:null, ...body}]); }
    for (const a of (b.att || [])){ const {id, ...body} = a; ops.push(["set", FB.db.doc("att/" + id), body]); }
    ops.push(["set", FB.db.doc("meta/org"), {source:b.source || "excel", updatedAt:nowIso(), students:n}]);
    const facs = [...new Set(b.groups.map(g => g.fac).filter(Boolean))];
    ops.push(["set", FB.db.doc("meta/facs"), {list:facs}]);
    for (let i = 0; i < ops.length; i += 200){
      const batch = FB.db.batch();
      for (const [k, ref, body] of ops.slice(i, i + 200)) k === "del" ? batch.delete(ref) : batch.set(ref, body);
      await batch.commit();
      S.busy = `Yozilmoqda: ${Math.min(i + 200, ops.length)}/${ops.length}`; renderSoon();
    }
    log("replace", `${b.source} ${n} talaba`);
    return {ok:true, students:n};
  },
  async "/api/clear"(){
    const refs = [];
    for (const c of ["groups","dorms","att"]){ const s = await col(c).get(); s.forEach(d => refs.push(d.ref)); }
    refs.push(FB.db.doc("meta/org"));
    for (let i = 0; i < refs.length; i += 300){ const batch = FB.db.batch(); refs.slice(i, i + 300).forEach(r => batch.delete(r)); await batch.commit(); }
    log("clear", "");
    return {ok:true};
  },
  async "/api/staff"(b){
    const name = cleanName(b.name);
    const perms = {stat_all:!!b.stat_all, stat_fac:!!b.stat_fac, facs:b.stat_fac ? (b.facs || []) : [], grp:!!b.grp, groups:b.grp ? (b.groups || []) : [],
      dorm:!!b.dorm, dorms:b.dorm ? (b.dorms || []) : [], import:!!b.import, users:!!b.users, struct:!!b.struct, approve:!!b.approve};
    const mine = S.perms || {};
    if (!mine.owner) for (const k of ["stat_all","import","users","struct","approve"]) if (perms[k] && !mine[k]) throw E(403, "Oʻzingizda yoʻq huquqni boshqaga bera olmaysiz.");
    let uid = b.uid;
    if (uid){
      if (uid === FB.uid) throw E(403, "Oʻz hisobingiz huquqlarini oʻzgartira olmaysiz.");
      const prev = S.staff.get(uid) || S.requests.get(uid) || {};
      await FB.db.doc("users/" + uid).update({name, perms, status:"active", updated:nowIso()});
      await syncNames(uid, name, prev, perms);
      log("staff", `${prev.username || uid} ${name}`);
      return {ok:true, id:uid};
    }
    // yangi hisob: ikkinchi (vaqtinchalik) Firebase ulanishi orqali — administrator tizimdan chiqib ketmaydi
    const username = cleanUsername(b.username);
    checkPw(b.password, username);
    const sec = firebase.apps.find(a => a.name === "secondary") || firebase.initializeApp(window.TALABAMAKON_FIREBASE, "secondary");
    const cred = await sec.auth().createUserWithEmailAndPassword(toEmail(username), b.password);
    uid = cred.user.uid;
    await sec.auth().signOut();
    await FB.db.doc("users/" + uid).set({name, username, status:"active", owner:false, perms, created:nowIso(), updated:nowIso()});
    await syncNames(uid, name, {}, perms);
    log("create", `${username} ${name}`);
    return {ok:true, id:uid};
  },
  async "/api/revoke"(b){
    if (b.uid === FB.uid) throw E(403, "Oʻz huquqlaringizni olib qoʻya olmaysiz.");
    const prev = S.staff.get(b.uid) || S.requests.get(b.uid) || {};
    await FB.db.doc("users/" + b.uid).delete();
    await syncNames(b.uid, "", prev, {groups:[], dorms:[]});
    log("revoke", prev.username || b.uid);
    return {ok:true};
  },
  async "/api/settings"(b){
    await FB.db.doc("meta/public").set({allowRegister:!!b.allowRegister, hasOwner:true}, {merge:true});
    log("settings", `allowRegister=${!!b.allowRegister}`);
    return {ok:true};
  },
  async "/api/audit"(){
    const s = await col("audit").orderBy("at", "desc").limit(400).get();
    const names = new Map([[FB.uid, S.me.name]]);
    for (const m of [S.staff, S.requests]) for (const [k, v] of m) names.set(k, v.name);
    const items = []; s.forEach(d => { const a = d.data(); items.push({at:a.at, action:a.action, detail:a.detail || "", who:names.get(a.uid) || "oʻchirilgan hisob"}); });
    return {items};
  },
  async "/api/fac"(b){
    const name = String(b.name || "").trim();
    const ref = FB.db.doc("meta/facs");
    const list = [...new Set([...(S.facList || []), ...[...S.groups.values()].map(g => g.fac)].filter(Boolean))];
    if (b.action === "add"){
      if (name.length < 3) throw E(400, "Fakultet nomini toʻliq yozing.");
      if (list.some(x => x.toLowerCase() === name.toLowerCase())) throw E(400, "Bu fakultet allaqachon bor.");
      await ref.set({list:[...list, name]});
    } else if (b.action === "rename"){
      const nn = String(b.newName || "").trim(); if (nn.length < 3) throw E(400, "Yangi nomni toʻliq yozing.");
      const batch = FB.db.batch();
      for (const g of S.groups.values()) if (g.fac === name) batch.update(FB.db.doc("groups/" + g.id), {fac:nn});
      batch.set(ref, {list:list.map(x => x === name ? nn : x)});
      await batch.commit();
      if (S.perms.users) for (const st of S.staff.values()) if ((st.facs || []).includes(name))
        await FB.db.doc("users/" + st.id).update({"perms.facs": st.facs.map(x => x === name ? nn : x)}).catch(() => {});
    } else if (b.action === "delete"){
      if ([...S.groups.values()].some(g => g.fac === name)) throw E(400, "Fakultetda guruhlar bor — avval ularni oʻchiring.");
      await ref.set({list:list.filter(x => x !== name)});
    }
    log("fac-" + b.action, name);
    return {ok:true};
  },
  async "/api/group"(b){
    if (b.action === "add"){
      const name = String(b.name || "").trim(), fac = String(b.fac || "").trim();
      if (!name || !fac) throw E(400, "Guruh nomi va fakultetni kiriting.");
      if ([...S.groups.values()].some(g => g.name === name && g.fac === fac)) throw E(400, "Bu fakultetda shu nomli guruh bor.");
      const ref = col("groups").doc();
      await ref.set({name, fac, course:String(b.course || ""), branch:"", tutor:"", students:[], updatedAt:nowIso()});
      if (b.tutorUid) await setGroupTutor(ref.id, b.tutorUid);
      log("group-add", `${fac} ${name}`);
      return {ok:true, id:ref.id};
    }
    const g = S.groups.get(b.gid); if (!g) throw E(404, "Guruh topilmadi.");
    if (b.action === "tutor"){ await setGroupTutor(b.gid, b.tutorUid); log("group-tutor", `${b.gid} ${b.tutorUid || "-"}`); return {ok:true}; }
    if (b.action === "delete"){
      if ((g.students || []).length) throw E(400, "Guruhda talabalar bor — oʻchirib boʻlmaydi.");
      await FB.db.doc("groups/" + b.gid).delete();
      log("group-delete", g.name); return {ok:true};
    }
    if (b.action === "student"){
      const n = cleanName(b.n);
      const ref = FB.db.doc("groups/" + b.gid);
      await tx(async t => {
        const s = await t.get(ref);
        const students = [...(s.data().students || []), {id:"s" + Math.random().toString(36).slice(2, 12), n, g:["Q","O"].includes(b.g) ? b.g : "",
          ph:String(b.ph || "").slice(0, 30), vil:String(b.vil || "").slice(0, 80), tum:String(b.tum || "").slice(0, 80), rt:"", ra:"", iz:"", up:""}];
        t.update(ref, {students, updatedAt:nowIso()});
      });
      log("student-add", `${b.gid} ${n}`); return {ok:true};
    }
    throw E(400, "Notoʻgʻri amal.");
  },
  async "/api/dorm/new"(b){
    const name = String(b.name || "").trim();
    if (name.length < 2) throw E(400, "Yotoqxona nomini yozing.");
    if ([...S.dorms.values()].some(d => d.name.toLowerCase() === name.toLowerCase())) throw E(400, "Bu nomli yotoqxona bor.");
    await col("dorms").add({name, branch:"", tarb:"", rooms:[], assign:{}, draft:null, created:nowIso()});
    log("dorm-new", name); return {ok:true};
  },
  async "/api/dorm/draft"(b){
    const d = S.dorms.get(b.did); if (!d) throw E(404, "Yotoqxona topilmadi.");
    const ref = FB.db.doc("dorms/" + b.did);
    if (b.withdraw){ if (d.draft) await ref.update({draft:{...d.draft, status:"draft"}}); return {ok:true}; }
    if (b.discard){ await ref.update({draft:null}); return {ok:true}; }
    if (d.draft && d.draft.status === "pending") throw E(400, "Oʻzgarishlar tasdiqlash kutmoqda. Avval soʻrovni qaytarib oling.");
    await ref.update({draft:{rooms:cleanRooms(b.rooms), status:"draft", by:S.me.name, at:nowIso(), note:""}});
    return {ok:true};
  },
  async "/api/dorm/submit"(b){
    // qoralamani saqlash va tasdiqqa yuborish — bitta yozuvda (oraliq holat boʻlmaydi)
    const ref = FB.db.doc("dorms/" + b.did);
    let name = "";
    await tx(async t => {
      const s = await t.get(ref); if (!s.exists) throw E(404, "Yotoqxona topilmadi.");
      const d = s.data(); name = d.name;
      if (d.draft && d.draft.status === "pending") throw E(400, "Oʻzgarishlar allaqachon tasdiqlash kutmoqda.");
      const rooms = b.rooms ? cleanRooms(b.rooms) : (d.draft && d.draft.rooms);
      if (!rooms) throw E(400, "Yuboriladigan oʻzgarish yoʻq.");
      t.update(ref, {draft:{rooms, status:"pending", by:S.me.name, at:nowIso(), note:""}});
    });
    log("dorm-submit", name); return {ok:true};
  },
  async "/api/dorm/decide"(b){
    const ref = FB.db.doc("dorms/" + b.did);
    let dname = "";
    await tx(async t => {
      const s = await t.get(ref); const d = s.data(); dname = d.name;
      if (!d.draft || d.draft.status !== "pending") throw E(400, "Tasdiqlanadigan oʻzgarish yoʻq.");
      if (b.decision === "approve"){
        const rooms = cleanRooms(d.draft.rooms), byId = new Map(rooms.map(r => [r.id, r])), assign = d.assign || {};
        for (const rid of Object.values(assign)) if (!byId.has(rid)){ const old = (d.rooms || []).find(r => r.id === rid) || {}; throw E(400, `Xona ${old.no || "?"}da talaba yashaydi — uni oʻchirib boʻlmaydi. Rad eting yoki avval talabani koʻchiring.`); }
        for (const r of rooms) if (Object.values(assign).filter(v => v === r.id).length > r.cap) throw E(400, `Xona ${r.no}: yangi sigʻim yashovchilar sonidan kam.`);
        t.update(ref, {rooms, draft:null, approved:{by:S.me.name, at:nowIso(), from:d.draft.by || ""}});
      } else if (b.decision === "reject"){
        t.update(ref, {draft:{...d.draft, status:"rejected", note:String(b.note || "").slice(0, 300), decidedBy:S.me.name}});
      } else throw E(400, "Notoʻgʻri qaror.");
    });
    log(b.decision === "approve" ? "dorm-approve" : "dorm-reject", dname);
    return {ok:true};
  }
};
function cleanRooms(rooms){
  const seen = new Set();
  return (rooms || []).map(r => {
    const no = String(r.no || "").trim().slice(0, 12);
    if (!no) throw E(400, "Xona raqami boʻsh boʻlmasin.");
    if (seen.has(no)) throw E(400, `Xona ${no} ikki marta yozilgan.`); seen.add(no);
    const fl = parseInt(r.fl, 10), cap = parseInt(r.cap, 10);
    if (!(fl >= 0 && fl <= 40) || !(cap >= 1 && cap <= 20)) throw E(400, `Xona ${no}: sigʻim 1–20 oraligʻida boʻlsin.`);
    return {id:String(r.id || ("r" + Math.random().toString(36).slice(2, 10))).slice(0, 20), fl, no, cap, g:["Q","O"].includes(r.g) ? r.g : ""};
  });
}
// tyutor biriktirish: shu guruh huquqini tanlangan odamga beradi va boshqalardan oladi
async function setGroupTutor(gid, uid){
  if (!S.perms.users) throw E(403, "Tyutor biriktirish uchun “Foydalanuvchilar va huquqlar” vazifasi kerak.");
  const batch = FB.db.batch();
  let name = "";
  for (const st of S.staff.values()){
    const has = (st.groups || []).includes(gid), want = st.id === uid;
    if (want) name = st.name;
    if (has === want) continue;
    const groups = want ? [...(st.groups || []), gid] : (st.groups || []).filter(x => x !== gid);
    batch.update(FB.db.doc("users/" + st.id), {"perms.groups":groups, "perms.grp":want ? true : !!st.grp, updated:nowIso()});
  }
  batch.update(FB.db.doc("groups/" + gid), {tutor:name});
  await batch.commit();
}
// guruh va yotoqxona kartalaridagi ismlarni huquqlarga moslash
async function syncNames(uid, name, prev, perms){
  const batch = FB.db.batch(); let n = 0;
  const was = new Set(prev.groups || []), now = new Set(perms.grp === false ? [] : (perms.groups || []));
  for (const gid of new Set([...was, ...now])){
    const g = S.groups.get(gid); if (!g) continue;
    if (now.has(gid) && g.tutor !== name){ batch.update(FB.db.doc("groups/" + gid), {tutor:name}); n++; }
    if (!now.has(gid) && was.has(gid) && g.tutor === prev.name){ batch.update(FB.db.doc("groups/" + gid), {tutor:""}); n++; }
  }
  const dw = new Set(prev.dorms || []), dn = new Set(perms.dorm === false ? [] : (perms.dorms || []));
  for (const did of new Set([...dw, ...dn])){
    const d = S.dorms.get(did); if (!d) continue;
    if (dn.has(did) && d.tarb !== name){ batch.update(FB.db.doc("dorms/" + did), {tarb:name}); n++; }
    if (!dn.has(did) && dw.has(did) && d.tarb === prev.name){ batch.update(FB.db.doc("dorms/" + did), {tarb:""}); n++; }
  }
  if (n) await batch.commit().catch(() => {});
}

async function api(path, body){
  if (!FB.ok) throw E(0, "Firebase sozlanmagan.");
  const fn = API[path]; if (!fn) throw E(404, "Topilmadi.");
  try { return await fn(body || {}); } catch (e){ throw fbErr(e); }
}
/* run a write, show its error; the live listeners refresh the page */
async function act(path, body, okMsg){
  try { await api(path, body); if (okMsg) toast(okMsg); renderSoon(); return true; }
  catch (e){ toast(e.error || "Saqlanmadi."); return false; }
}
async function loadState(){ renderSoon(); }
async function loadMe(){ setAuthState(); }

/* ---------------- rights ---------------- */
function P(){
  const p = S.perms; if (!p) return null;
  return {...p, groups:(p.groups || []).filter(g => S.groups.has(g)), dorms:(p.dorms || []).filter(d => S.dorms.has(d))};
}
const canStats = p => !!p && (p.stat_all || (p.stat_fac && p.facs.length > 0));
const facLocked = () => { const p = P(); return !!p && !p.stat_all && p.facs.length === 1; };
const tarbOf = d => (S.dormStaff[d.id] || []).join(", ") || d.tarb || "";
function rightsChips(s){
  const out = [];
  if (s.stat_all) out.push("Butun filial statistikasi");
  if (s.stat_fac && (s.facs||[]).length) out.push("Statistika: " + s.facs.join(", "));
  if (s.grp && (s.groups||[]).length){ const names = s.groups.map(g => S.groups.get(g)?.name).filter(Boolean); out.push(`Turar joy kiritish: ${names.length > 4 ? names.length+" ta guruh" : names.join(", ")}`); }
  if (s.dorm && (s.dorms||[]).length) out.push("Yotoqxona: " + s.dorms.map(d => S.dorms.get(d)?.name).filter(Boolean).join(", "));
  if (s.struct) out.push("Tuzilmani boshqarish");
  if (s.approve) out.push("Tasdiqlash");
  if (s.import) out.push("Maʼlumot yuklash");
  if (s.users) out.push("Foydalanuvchilar va huquqlar");
  return out.length ? `<div class="rights">${out.map(x => `<span class="chip">${esc(x)}</span>`).join("")}</div>` : `<span class="muted">Huquq berilmagan</span>`;
}

/* ---------------- derived data ---------------- */
let cacheKey = null, cacheList = [];
function allStudents(){
  if (cacheKey === S.groups) return cacheList;
  const out = [];
  for (const [gid, g] of S.groups){ const tutor = S.tutors[gid] ? S.tutors[gid].join(", ") : (g.tutor || "");
    for (const s of (g.students || [])) out.push({...s, gid, gname:g.name, fac:g.fac, course:g.course, tutor, branch:g.branch}); }
  cacheKey = S.groups; cacheList = out; return out;
}
const byId = () => { const m = new Map(); for (const s of allStudents()) m.set(s.id, s); return m; };
const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), "uz"));
const branches = () => uniq(allStudents().map(s => s.branch));
const faculties = () => uniq([...S.facList, ...[...S.groups.values()].map(g => g.fac)]);

function scoped(){
  const p = P(); let list = allStudents();
  if (!p || p.stat_all) return list;
  return list.filter(s => p.facs.includes(s.fac));
}
function filtered(list){
  const f = S.f;
  return list.filter(s => (!f.branch || s.branch === f.branch) && (!f.fac || s.fac === f.fac) &&
    (!f.course || String(s.course) === f.course) && (!f.g || s.g === f.g) && (!f.rt || (s.rt||"") === (f.rt === "none" ? "" : f.rt)));
}
function stats(list){
  const st = {total:list.length, Q:0, O:0, by:{}};
  for (const t of TYPES) st.by[t.k] = {n:0, Q:0, O:0};
  for (const s of list){ const b = st.by[s.rt || ""] || st.by[""]; b.n++; if (s.g === "Q"){ b.Q++; st.Q++; } else if (s.g === "O"){ b.O++; st.O++; } }
  return st;
}
const groupBy = (list, fn) => { const m = new Map(); for (const s of list){ const k = fn(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); } return m; };

/* dorm helpers */
function dormList(){ return [...S.dorms.values()].sort((a,b) => a.name.localeCompare(b.name, "uz")); }
function dormOf(s){
  const ds = dormList(); if (!ds.length) return null;
  const n = norm(s.ra);
  const exact = ds.find(d => norm(d.name) === n);
  if (exact) return exact;
  const sameBranch = ds.filter(d => !d.branch || d.branch === s.branch);
  return sameBranch.length === 1 ? sameBranch[0] : null;
}
function dormInfo(d){
  const ids = byId();
  const assign = d.assign || {};
  const rooms = d.rooms || [];
  const cap = rooms.reduce((a,r) => a + (+r.cap || 0), 0);
  const occ = {};
  for (const [sid, rid] of Object.entries(assign)) (occ[rid] ||= []).push(sid);
  const living = Object.keys(assign).filter(sid => ids.has(sid)).map(sid => ids.get(sid));
  const left = Object.keys(assign).filter(sid => ids.has(sid) && ids.get(sid).rt !== "TTJ");
  const queue = allStudents().filter(s => s.rt === "TTJ" && !assign[s.id] && dormOf(s)?.id === d.id);
  const unmatched = allStudents().filter(s => s.rt === "TTJ" && !assign[s.id] && !dormOf(s));
  const marks = S.att.get(`${d.id}_${TODAY}`)?.marks || {};
  const today = {un:0}; for (const a of ATT) today[a.k] = 0;
  for (const s of living){ const m = marks[s.id]; if (m && today[m] != null) today[m]++; else today.un++; }
  const streak = living.filter(s => DAYS3.every(day => (S.att.get(`${d.id}_${day}`)?.marks || {})[s.id] === "sababsiz"));
  return {cap, used:Object.keys(assign).length, occ, living, left, queue, unmatched, marks, today, streak, ids};
}

/* ---------------- render ---------------- */
function render(){
  const a = document.activeElement;
  const fid = a && a.id, sel = a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  const y = window.scrollY;
  const open = S.auth && S.auth.auth && S.loaded && S.perms;
  $app.innerHTML = open ? shell(P()) : gateView();
  if (fid){ const el = document.getElementById(fid); if (el){ el.focus({preventScroll:true}); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch {} } }
  window.scrollTo(0, y);
}
let rT = 0; function renderSoon(){ cancelAnimationFrame(rT); rT = requestAnimationFrame(render); }
const hasData = () => S.groups.size > 0 && [...S.groups.values()].some(g => (g.students || []).length);

function brandBlock(){ return `<div class="brand" style="font-size:15px"><span><b>Talaba</b>Makon</span> <small>talabalar turar joyi nazorati</small></div>`; }

/* the single entry */
function gateView(){
  let body;
  const err = S.formErr ? `<div class="alertbox">${esc(S.formErr)}</div>` : "";
  const inApp = navigator.userAgent.includes("TalabaMakonApp");
  const apk = !inApp && S.apkReady ? `<p class="sub"><a href="TalabaMakon.apk" download>Android ilovani yuklab olish (APK)</a></p>` : "";
  if (S.fbMissing){
    body = `<h1>Firebase sozlanmagan</h1><div class="alertbox"><b>public/firebase-config.js</b> fayliga Firebase loyihangiz sozlamalarini yozing va qayta joylang (firebase deploy).</div>`;
  } else if (S.auth === null){
    body = `<h1>Yuklanmoqda…</h1>${S.offline ? `<p class="lede">Internet bilan aloqa yoʻq. Ulanish tiklanganda sahifa oʻzi davom etadi.</p>` : ""}`;
  } else if (S.auth.auth && S.auth.status === "pending"){
    body = S.auth.needOwner
      ? `<h1>Bosh administratorni belgilang</h1>
        <p class="lede">Hisobingiz yaratildi. Tizimda hali bosh administrator yoʻq — uni faqat Firebase loyihasi egasi belgilaydi:</p>
        <ol class="lede" style="padding-left:20px;margin:0">
          <li>Firebase Console → <b>Firestore Database</b> → <b>users</b> → hujjat <code class="num">${esc(S.me.id)}</code></li>
          <li><b>owner</b> maydonini <b>true</b> ga, <b>status</b> ni <b>active</b> ga oʻzgartiring.</li>
          <li>Shu sahifaga qayting — boʻlimlar oʻzi ochiladi.</li></ol>
        <div class="actions"><button class="btn" data-act="logout">Chiqish</button></div>`
      : `<h1>Soʻrovingiz yuborildi</h1>
        <p class="lede">${esc(S.me.name)}, administrator sizga vazifa belgilashi bilan shu sahifaning oʻzida boʻlimlaringiz ochiladi.</p>
        <div class="actions"><button class="btn" data-act="logout">Chiqish</button><button class="link" data-act="cancelreq">Soʻrovni bekor qilish</button></div>`;
  } else if (S.auth.auth && S.auth.status === "none"){
    body = `<h1>Hisobingizga huquq berilmagan</h1>
      <p class="lede">Bu hisob administrator tomonidan oʻchirilgan yoki soʻrov hali yuborilmagan.</p>
      ${S.auth.allowRegister ? `<div class="panel" style="max-width:420px"><div class="field"><label for="a_name">Ism va familiya</label><input type="text" id="a_name" data-in="a_name" value="${esc(S.form.name)}"></div>${err}<div><button class="btn primary" data-act="rerequest">Kirish soʻrovini yuborish</button></div></div>` : `<p class="sub">Hisobni administrator ochadi.</p>`}
      <div class="actions"><button class="btn" data-act="logout">Chiqish</button></div>`;
  } else if (S.auth.auth){
    body = `<h1>Yuklanmoqda…</h1>`;
  } else if (S.gate === "setup"){
    body = `<h1>Birinchi hisob</h1>
      <p class="lede">Tizimda hali hech kim yoʻq. Hisob yarating — keyin uni Firebase Console orqali <b>bosh administrator</b> qilasiz (keyingi sahifada koʻrsatiladi).</p>
      ${authForm(true)}${err}<div class="actions"><button class="btn primary" data-act="register">Hisobni yaratish</button><button class="link" data-act="gate" data-to="login">Hisobim bor — kirish</button></div>`;
  } else if (S.gate === "register"){
    body = `<h1>Kirish soʻrovi</h1>
      <p class="lede">Hisob oching. Administrator vazifalaringizni belgilagach, kerakli boʻlimlar ochiladi.</p>
      ${authForm(true)}${err}<div class="actions"><button class="btn primary" data-act="register">Soʻrov yuborish</button><button class="link" data-act="gate" data-to="login">Hisobim bor — kirish</button></div>`;
  } else {
    body = `<h1>Tizimga kirish</h1>
      ${authForm(false)}${err}<div class="actions"><button class="btn primary" data-act="login">Kirish</button>${S.auth.allowRegister ? `<button class="link" data-act="gate" data-to="register">Hisobim yoʻq — soʻrov yuborish</button>` : `<span class="sub">Hisobni administrator ochadi.</span>`}</div>`;
  }
  return `<div class="wrap"><div class="login">${brandBlock()}${body}${apk}</div></div>`;
}
function authForm(withName, withToken){
  const f = S.form;
  return `<form class="panel" style="max-width:420px" data-form="auth" autocomplete="on">
    ${withToken ? `<div class="field"><label for="a_token">Oʻrnatish kodi</label><input type="text" id="a_token" data-in="a_token" value="${esc(f.token || "")}" autocomplete="off" spellcheck="false" placeholder="masalan: 3fa9c1-07b2de-9c41aa"></div>` : ""}
    ${withName ? `<div class="field"><label for="a_name">Ism va familiya</label><input type="text" id="a_name" data-in="a_name" value="${esc(f.name)}" autocomplete="name" placeholder="Masalan: Oʻroqov Rustam"></div>` : ""}
    <div class="field"><label for="a_user">Login</label><input type="text" id="a_user" data-in="a_user" value="${esc(f.username)}" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
    <div class="field"><label for="a_pass">Parol</label><input type="password" id="a_pass" data-in="a_pass" value="${esc(f.password)}" autocomplete="${withName ? "new-password" : "current-password"}">${withName ? `<span class="sub">Kamida 8 belgi, harf va raqam boʻlsin.</span>` : ""}</div>
    <button type="submit" hidden></button></form>`;
}
function selectField(id, label, opts, val, any){
  return `<div class="field"><label for="${id}">${esc(label)}</label><select id="${id}" data-ch="${id}">
    ${any !== undefined ? `<option value="">${esc(any)}</option>` : `<option value="" disabled ${val ? "" : "selected"}>Tanlang…</option>`}
    ${opts.map(([v,t]) => `<option value="${esc(v)}" ${String(v)===String(val) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></div>`;
}

const pendingApprovals = () => dormList().filter(d => d.draft && d.draft.status === "pending");
function tabsFor(p){
  const t = [];
  if (canStats(p)) t.push(["umumiy","Umumiy"],["fakultetlar", facLocked() ? "Kurslar" : "Fakultetlar"],["tyutorlar","Tyutorlar"],["yotoqxona","Yotoqxonalar"],["talabalar","Talabalar"]);
  if (p.grp && p.groups.length) t.push(["guruhlar","Guruhlarim"]);
  if (p.dorm && p.dorms.length) t.push(["ttj","Yotoqxonani boshqarish"]);
  if (p.approve){ const n = pendingApprovals().length; t.push(["tasdiq", `Tasdiqlash${n ? ` · ${n}` : ""}`]); }
  if (p.struct) t.push(["tuzilma","Tuzilma"]);
  if (p.import) t.push(["yuklash","Maʼlumot yuklash"]);
  if (p.users){ const n = S.requests.size; t.push(["users", `Foydalanuvchilar${n ? ` · ${n}` : ""}`], ["jurnal","Jurnal"]); }
  return t;
}
function shell(p){
  const tabs = tabsFor(p);
  const demo = S.org?.source === "demo" ? `<span class="chip demo">Namuna maʼlumot</span>` : "";
  const off = S.offline ? `<span class="chip demo">Server bilan aloqa uzildi</span>` : "";
  const header = `<header class="top"><div class="wrap">
      <div class="brand"><span><b>Talaba</b>Makon</span></div>${demo}${off}
      <div class="who"><div class="role"><strong>${esc(S.me.name)}</strong>${esc(S.me.username || "")}</div><button class="btn sm" data-act="pwopen">Parol</button><button class="btn sm" data-act="logout">Chiqish</button></div></div></header>`;
  if (S.pwOpen) return header + `<main class="wrap">${passwordView()}</main>`;
  if (!tabs.length) return header + `<main class="wrap"><div class="empty"><h2>Sizga hali vazifa belgilanmagan</h2><p class="muted">Administrator huquq bergach, boʻlimlar shu yerda ochiladi.</p></div></main>`;
  if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
  const tabHtml = tabs.length > 1 ? `<div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button class="tab" role="tab" aria-selected="${S.tab===k}" data-act="tab" data-tab="${k}">${esc(l)}</button>`).join("")}</div>` : "";
  let body = "";
  const noData = !hasData() && ["umumiy","fakultetlar","tyutorlar","talabalar","guruhlar"].includes(S.tab);
  if (noData) body = `<div class="empty"><h2>Bazada hali talabalar yoʻq</h2><p class="muted">${p.import ? "“Maʼlumot yuklash” boʻlimidan Excel shablonni yuklang yoki tizimni namuna maʼlumot bilan sinab koʻring." : "Talabalar roʻyxati yuklangach, maʼlumot shu yerda koʻrinadi."}</p>
    ${p.import ? `<div class="actions"><button class="btn primary" data-act="tab" data-tab="yuklash">Maʼlumot yuklash</button></div>` : ""}</div>`;
  else if (S.tab === "yuklash") body = importView();
  else if (S.tab === "users") body = usersView();
  else if (S.tab === "jurnal") body = auditView();
  else if (S.tab === "guruhlar") body = tutorView(p);
  else if (S.tab === "ttj") body = dormView(p);
  else if (S.tab === "tasdiq") body = approveView();
  else if (S.tab === "tuzilma") body = structView();
  else if (S.tab === "yotoqxona") body = leaderDorms(p);
  else {
    const list = filtered(scoped());
    const fbar = filterBar(p);
    if (S.tab === "umumiy") body = fbar + overview(list);
    if (S.tab === "fakultetlar") body = fbar + facultyTab(list);
    if (S.tab === "tyutorlar") body = fbar + tutorTab(list);
    if (S.tab === "talabalar") body = fbar + studentTable(list);
  }
  return header + `<main class="wrap">${tabHtml}${body}</main>`;
}
/* ----- shared pieces ----- */
function stackBar(st, big){
  if (!st.total) return `<div class="stack${big ? " big" : ""}"></div>`;
  return `<div class="stack${big ? " big" : ""}" role="img" aria-label="${TYPES.map(t => `${t.s} ${st.by[t.k].n}`).join(", ")}">${TYPES.map(t => {
    const n = st.by[t.k].n; if (!n) return "";
    return `<span class="s" style="width:${n/st.total*100}%;background:var(${t.v})" title="${esc(t.s)}: ${n} (${pct(n,st.total)}%)"></span>`;
  }).join("")}</div>`;
}
const legend = () => `<div class="legend">${TYPES.map(t => `<span><i class="dot" style="background:var(${t.v})"></i>${esc(t.s)}</span>`).join("")}</div>`;
function kpiRow(st){
  const lead = `<div class="kpi lead"><div class="lab">Jami talabalar</div><div class="val">${st.total}</div><div class="gq">Qiz ${st.Q} · Oʻgʻil ${st.O}</div></div>`;
  return `<div class="kpis">${lead}${TYPES.map(t => { const b = st.by[t.k];
    return `<div class="kpi${t.k==="" && b.n ? " alert" : ""}"><div class="lab"><i class="dot" style="background:var(${t.v})"></i>${esc(t.l)}</div>
      <div class="val">${b.n}<small>${pct(b.n, st.total)}%</small></div><div class="gq">Qiz ${b.Q} · Oʻgʻil ${b.O}</div></div>`; }).join("")}</div>`;
}
function rowBars(map, order){
  const keys = order || [...map.keys()];
  return `<div class="rows">${keys.map(k => { const st = stats(map.get(k) || []);
    return `<div class="rowbar"><div class="nm" title="${esc(k)}">${esc(k || "—")}</div>${stackBar(st)}<div class="n">${st.total}</div></div>`; }).join("")}</div>`;
}
function typeTable(map, firstCol, keys){
  keys = keys || [...map.keys()];
  return `<div class="tbl"><table><thead><tr><th>${esc(firstCol)}</th><th class="r">Jami</th><th class="r">Qiz</th><th class="r">Oʻgʻil</th>${TYPES.map(t => `<th class="r">${esc(t.s)}</th>`).join("")}</tr></thead><tbody>
    ${keys.map(k => { const st = stats(map.get(k) || []);
      return `<tr><td>${esc(k || "—")}</td><td class="r num">${st.total}</td><td class="r num">${st.Q}</td><td class="r num">${st.O}</td>${TYPES.map(t => `<td class="r num">${st.by[t.k].n || `<span class="muted">0</span>`}</td>`).join("")}</tr>`; }).join("")}
  </tbody></table></div>`;
}

/* ----- statistics ----- */
function filterBar(p){
  const f = S.f, b = branches();
  const parts = [];
  if (b.length > 1 && p.stat_all) parts.push(selectField("f_branch","Filial", b.map(x=>[x,x]), f.branch, "Barcha filiallar"));
  const facs = p.stat_all ? faculties() : p.facs;
  if (facs.length > 1) parts.push(selectField("f_fac","Fakultet", facs.map(x=>[x,x]), f.fac, "Barcha fakultetlar"));
  parts.push(selectField("f_course","Kurs", uniq(scoped().map(s => String(s.course))).map(x=>[x, x+"-kurs"]), f.course, "Barcha kurslar"));
  parts.push(selectField("f_g","Jinsi", [["Q","Qiz"],["O","Oʻgʻil"]], f.g, "Hammasi"));
  parts.push(selectField("f_rt","Turar joy", TYPES.map(t => [t.k || "none", t.s]), f.rt, "Barcha turlar"));
  const any = Object.values(f).some(Boolean);
  const scopeNote = !p.stat_all ? `<span class="chip">${esc(p.facs.join(", "))}</span>` : "";
  return `<div class="filters">${scopeNote}${parts.join("")}${any ? `<button class="btn sm" data-act="clearf">Filtrni tozalash</button>` : ""}</div>`;
}
function overview(list){
  const st = stats(list);
  if (!st.total) return `<div class="empty"><h2>Tanlangan filtr boʻyicha talaba yoʻq</h2></div>`;
  const byCourse = facLocked();
  const facMap = groupBy(list, s => s.fac);
  const facKeys = [...facMap.keys()].sort((a,b) => facMap.get(b).length - facMap.get(a).length);
  const gMap = new Map([["Qiz", list.filter(s => s.g === "Q")], ["Oʻgʻil", list.filter(s => s.g === "O")]]);
  const regions = groupBy(list.filter(s => s.vil || s.tum), s => [s.vil, s.tum].filter(Boolean).join(", "));
  const regKeys = [...regions.keys()].sort((a,b) => regions.get(b).length - regions.get(a).length).slice(0, 10);
  const fillPct = pct(st.total - st.by[""].n, st.total);
  return `${kpiRow(st)}
  <div class="panel"><div class="panel-head"><h2>Turar joy taqsimoti</h2><span class="sub">Maʼlumot toʻldirilgan: <b class="num">${fillPct}%</b></span></div>${stackBar(st, true)}${legend()}</div>
  <div class="grid2">
    <div class="panel"><div class="panel-head"><h2>${byCourse ? "Kurslar" : "Fakultetlar"} kesimida</h2><span class="sub">har bir qator 100%</span></div>
      ${byCourse ? rowBars(groupBy(list, s => s.course+"-kurs"), uniq(list.map(s => s.course+"-kurs"))) : rowBars(facMap, facKeys)}</div>
    <div class="panel"><div class="panel-head"><h2>Qiz va oʻgʻil kesimida</h2></div>${rowBars(gMap)}
      <h2 style="font-size:13.5px;margin-top:6px">Doimiy yashash joyi (eng koʻp 10 ta)</h2>
      <div class="rows">${regKeys.map(k => { const n = regions.get(k).length; return `<div class="rowbar"><div class="nm" title="${esc(k)}">${esc(k)}</div><div class="single"><i style="width:${n/regions.get(regKeys[0]).length*100}%"></i></div><div class="n">${n}</div></div>`; }).join("") || `<p class="muted">Manzil maʼlumoti yoʻq</p>`}</div></div>
  </div>`;
}
function facultyTab(list){
  const byCourse = facLocked();
  const map = byCourse ? groupBy(list, s => s.course+"-kurs") : groupBy(list, s => s.fac);
  const keys = byCourse ? uniq([...map.keys()]) : [...map.keys()].sort((a,b) => map.get(b).length - map.get(a).length);
  const gm = groupBy(list, s => s.gname);
  const gkeys = [...gm.keys()].sort((a,b) => String(a).localeCompare(String(b),"uz"));
  return `<div class="panel"><div class="panel-head"><h2>${byCourse ? "Kurslar" : "Fakultetlar"} boʻyicha</h2>${legend()}</div>${rowBars(map, keys)}${typeTable(map, byCourse ? "Kurs" : "Fakultet", keys)}</div>
  <div class="panel"><div class="panel-head"><h2>Guruhlar boʻyicha</h2><span class="sub">${gkeys.length} ta guruh</span></div>${typeTable(gm, "Guruh", gkeys)}</div>`;
}
function tutorTab(list){
  const map = groupBy(list, s => s.tutor || "Biriktirilmagan");
  const rows = [...map.entries()].map(([t, arr]) => { const st = stats(arr); const filled = st.total - st.by[""].n;
    const last = arr.reduce((m,s) => s.up && s.up > m ? s.up : m, "");
    const groups = uniq(arr.map(s => s.gname));
    return {t, st, fp:pct(filled, st.total), last, groups}; }).sort((a,b) => a.fp - b.fp || b.st.total - a.st.total);
  return `<div class="panel"><div class="panel-head"><h2>Tyutorlar faoliyati</h2><span class="sub">Toʻldirilganlik boʻyicha — eng pastidan</span></div>
  <div class="tbl"><table><thead><tr><th>Tyutor</th><th>Guruhlar</th><th class="r">Talaba</th>${TYPES.map(t => `<th class="r">${esc(t.s)}</th>`).join("")}<th>Toʻldirilgan</th><th>Oxirgi yangilash</th></tr></thead><tbody>
  ${rows.map(r => `<tr class="${r.fp < 80 ? "warnrow" : ""}"><td><b>${esc(r.t)}</b></td><td class="muted">${esc(r.groups.join(", "))}</td><td class="r num">${r.st.total}</td>
    ${TYPES.map(t => `<td class="r num">${r.st.by[t.k].n}</td>`).join("")}
    <td><div style="display:flex;align-items:center;gap:8px"><div class="single" style="width:80px"><i style="width:${r.fp}%;background:var(${r.fp<80 ? "--warn" : "--good"})"></i></div><span class="num">${r.fp}%</span></div></td>
    <td class="num muted">${fmtDate(r.last)}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}
function studentTable(list){
  const q = norm(S.q);
  let rows = q ? list.filter(s => norm(s.n).includes(q) || norm(s.gname).includes(q) || norm(s.ra).includes(q)) : list;
  rows = [...rows].sort((a,b) => (a.fac||"").localeCompare(b.fac||"","uz") || String(a.gname).localeCompare(String(b.gname),"uz") || a.n.localeCompare(b.n,"uz"));
  const shown = rows.slice(0, S.limit);
  return `<div class="panel"><div class="panel-head"><h2>Talabalar roʻyxati</h2><span class="sub num">${rows.length} ta</span></div>
    <div class="field" style="max-width:360px"><label for="q">Qidirish</label><input type="search" id="q" data-in="q" value="${esc(S.q)}" placeholder="F.I.Sh., guruh yoki manzil"></div>
    <div class="tbl"><table><thead><tr><th>F.I.Sh.</th><th>Jinsi</th><th>Fakultet</th><th>Guruh</th><th>Tyutor</th><th>Turar joy</th><th>Manzil</th><th>Doimiy joyi</th><th>Telefon</th></tr></thead><tbody>
    ${shown.map(s => { const t = TL[s.rt || ""] || TL[""];
      return `<tr><td><b>${esc(s.n)}</b></td><td>${GL[s.g] || "—"}</td><td>${esc(s.fac)}</td><td class="num">${esc(s.gname)}</td><td>${esc(s.tutor)}</td>
      <td><span class="pill"><i class="dot" style="background:var(${t.v})"></i>${esc(t.s)}</span></td><td>${esc(s.ra || "—")}</td><td class="muted">${esc([s.vil, s.tum].filter(Boolean).join(", ") || "—")}</td><td class="num">${esc(s.ph || "—")}</td></tr>`; }).join("")}
    </tbody></table></div>
    ${rows.length > shown.length ? `<button class="btn" data-act="more">Yana koʻrsatish (${rows.length - shown.length} ta qoldi)</button>` : ""}</div>`;
}
function leaderDorms(p){
  const ds = dormList();
  if (!ds.length) return `<div class="empty"><h2>Yotoqxonalar kiritilmagan</h2><p class="muted">Excel shablonning “TTJ xonalari” varagʻini toʻldirib yuklang.</p></div>`;
  const facScope = p.stat_all ? null : p.facs;
  return ds.map(d => { const I = dormInfo(d);
    const inScope = s => !facScope || facScope.includes(s.fac);
    const living = I.living.filter(inScope);
    const facMap = groupBy(living, s => s.fac);
    const qn = living.filter(s => s.g === "Q").length;
    const streak = I.streak.filter(inScope);
    const sabab = living.filter(s => I.marks[s.id] === "sababsiz");
    return `<div class="panel"><div class="panel-head"><h2>${esc(d.name)}</h2><span class="sub">Tarbiyachi: ${esc(tarbOf(d) || "—")}${d.branch ? " · "+esc(d.branch) : ""}</span></div>
      <div class="kpis">
        <div class="kpi lead"><div class="lab">Sigʻim</div><div class="val">${I.cap}</div><div class="gq">Boʻsh joy: ${Math.max(0, I.cap - I.used)}</div></div>
        <div class="kpi"><div class="lab">Yashaydi${facScope ? " (fakultet)" : ""}</div><div class="val">${living.length}</div><div class="gq">Qiz ${qn} · Oʻgʻil ${living.length - qn}</div></div>
        <div class="kpi"><div class="lab">Joylashtirish navbati</div><div class="val">${I.queue.filter(inScope).length}</div><div class="gq">TTJ deb belgilangan</div></div>
        ${ATT.map(a => `<div class="kpi${a.k==="sababsiz" && sabab.length ? " alert" : ""}"><div class="lab"><i class="dot" style="background:var(${a.v})"></i>Bugun: ${esc(a.l)}</div><div class="val">${living.filter(s => I.marks[s.id] === a.k).length}</div></div>`).join("")}
        <div class="kpi"><div class="lab"><i class="dot" style="background:var(--none)"></i>Belgilanmagan</div><div class="val">${living.filter(s => !I.marks[s.id]).length}</div></div>
      </div>
      ${streak.length ? `<div class="alertbox"><b>3 kun ketma-ket sababsiz yoʻq:</b> ${streak.map(s => `${esc(s.n)} (${esc(s.gname)}, tyutor ${esc(s.tutor || "—")})`).join("; ")}</div>` : ""}
      ${sabab.length ? `<div class="sub">Bugun sababsiz yoʻqlar: ${sabab.map(s => esc(s.n)+" — "+esc(s.gname)).join("; ")}</div>` : ""}
      ${facMap.size ? `<h2 style="font-size:13.5px">Yashovchilar fakultetlar kesimida</h2><div class="rows">${[...facMap.entries()].sort((a,b) => b[1].length - a[1].length).map(([f, arr]) => { const q = arr.filter(s => s.g==="Q").length;
        return `<div class="rowbar"><div class="nm">${esc(f)}</div><div class="stack"><span class="s" style="width:${q/arr.length*100}%;background:var(--qar)" title="Qiz ${q}"></span><span class="s" style="width:${(arr.length-q)/arr.length*100}%;background:var(--ttj)" title="Oʻgʻil ${arr.length-q}"></span></div><div class="n">${arr.length}</div></div>`; }).join("")}</div>
        <div class="legend"><span><i class="dot" style="background:var(--qar)"></i>Qiz</span><span><i class="dot" style="background:var(--ttj)"></i>Oʻgʻil</span></div>` : ""}
    </div>`; }).join("");
}

/* ----- residence entry (groups granted to this person) ----- */
function tutorView(p){
  const mine = allStudents().filter(s => p.groups.includes(s.gid));
  const st = stats(mine);
  const gm = groupBy(mine, s => s.gid);
  if (S.openGroup && gm.has(S.openGroup)) return tutorGroup(S.openGroup, gm.get(S.openGroup));
  const cards = [...gm.entries()].sort((a,b) => String(a[1][0].gname).localeCompare(String(b[1][0].gname), "uz")).map(([gid, arr]) => {
    const g = stats(arr); const filled = g.total - g.by[""].n;
    return `<button class="gcard" data-act="opengroup" data-gid="${esc(gid)}"><div class="meta">${esc(arr[0].fac)} · ${esc(arr[0].course)}-kurs</div><h3>${esc(arr[0].gname)}</h3>
      ${stackBar(g)}<div class="mini">${TYPES.map(t => `<span><i class="dot" style="background:var(${t.v})"></i> ${esc(t.s)} <b class="num">${g.by[t.k].n}</b></span>`).join("")}</div>
      <div class="fill">${g.total} talaba · toʻldirilgan ${pct(filled, g.total)}%</div></button>`; }).join("");
  return `<div><h1 style="font-size:22px">Guruhlarim</h1><p class="muted">Guruhni oching va har bir talabaning turar joyini kiriting. Oʻzgarish darhol rahbarlar statistikasida koʻrinadi.</p></div>
    ${kpiRow(st)}<div class="cards">${cards || `<div class="empty">Belgilangan guruhlarda talaba yoʻq.</div>`}</div>`;
}
function tutorGroup(gid, arr){
  const g = S.groups.get(gid);
  const st = stats(arr);
  const ro = !S.canWrite;
  const rows = [...arr].sort((a,b) => a.n.localeCompare(b.n, "uz")).map(s => { const t = TL[s.rt || ""] || TL[""];
    const d = s.rt === "TTJ" ? dormOf(s) : null; const room = d && d.assign && d.assign[s.id] ? (d.rooms||[]).find(r => r.id === d.assign[s.id]) : null;
    return `<tr class="${s.rt ? "" : "warnrow"}"><td><b>${esc(s.n)}</b><div class="muted" style="font-size:12px">${GL[s.g] || ""}${s.ph ? " · "+esc(s.ph) : ""}</div></td>
      <td><div style="display:flex;align-items:center;gap:6px"><i class="dot" style="background:var(${t.v})"></i>
        <select id="rt_${esc(s.id)}" data-ch="rt" data-gid="${esc(gid)}" data-sid="${esc(s.id)}" ${ro ? "disabled" : ""}>
        ${TYPES.map(x => `<option value="${x.k}" ${(s.rt||"")===x.k ? "selected" : ""}>${esc(x.k ? x.s : "— tanlang —")}</option>`).join("")}</select></div></td>
      <td><input type="text" id="ra_${esc(s.id)}" data-ch="ra" data-gid="${esc(gid)}" data-sid="${esc(s.id)}" value="${esc(s.ra || "")}" placeholder="${s.rt === "TTJ" ? "Yotoqxona nomi" : "Manzil"}" style="width:240px" ${ro ? "disabled" : ""}>
        ${s.rt === "TTJ" ? `<div class="muted" style="font-size:12px;margin-top:3px">${room ? "Xona "+esc(room.no) : d ? "Joylashtirish navbatida" : "Yotoqxona topilmadi"}</div>` : ""}</td>
      <td class="muted">${esc([s.vil, s.tum].filter(Boolean).join(", ") || "—")}</td>
      <td class="num muted">${fmtDate(s.up)}</td></tr>`; }).join("");
  return `<div class="actions"><button class="btn sm" data-act="closegroup">← Guruhlarim</button></div>
  <div class="panel"><div class="panel-head"><div><h2 style="font-size:20px" class="num">${esc(g?.name)}</h2><div class="sub">${esc(g?.fac)} · ${esc(g?.course)}-kurs · ${st.total} talaba</div></div>${legend()}</div>
  ${stackBar(st, true)}
  ${st.by[""].n ? `<div class="alertbox">${st.by[""].n} ta talabaning turar joyi kiritilmagan.</div>` : `<div class="okbox">Guruhning barcha talabalari maʼlumoti toʻldirilgan.</div>`}
  <div class="tbl"><table><thead><tr><th>Talaba</th><th>Turar joy turi</th><th>Manzil / yotoqxona</th><th>Doimiy joyi</th><th>Yangilangan</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/* ----- dorm management ----- */
function curDorm(p){
  if (!p.dorms.includes(S.curDorm)) S.curDorm = p.dorms[0] || "";
  return S.dorms.get(S.curDorm);
}
function dormView(p){
  const d = curDorm(p);
  if (!d) return `<div class="empty"><h2>Yotoqxona topilmadi</h2></div>`;
  const I = dormInfo(d);
  const qn = I.living.filter(s => s.g === "Q").length;
  const tabs = [["xonalar","Xonalar"],["navbat",`Navbat (${I.queue.length})`],["yoqlama","Yoʻqlama"],["statistika","Statistika"],["tuzilma", `Qavat va xonalar${d.draft && d.draft.status === "pending" ? " · tasdiqda" : d.draft && d.draft.status === "rejected" ? " · rad etilgan" : ""}`]];
  let body = "";
  if (S.dormTab === "xonalar") body = roomsTab(d, I);
  if (S.dormTab === "navbat") body = queueTab(d, I);
  if (S.dormTab === "yoqlama") body = attTab(d, I);
  if (S.dormTab === "statistika") body = dormStats(d, I);
  if (S.dormTab === "tuzilma") body = dormEditTab(d);
  const pickDorm = p.dorms.length > 1 ? selectField("curdorm", "Yotoqxona", p.dorms.map(id => [id, S.dorms.get(id).name]), d.id) : "";
  return `<div class="panel-head"><div><h1 style="font-size:22px">${esc(d.name)}</h1><p class="muted">Bugun ${fmtDate(new Date().toISOString())}${tarbOf(d) ? " · tarbiyachi "+esc(tarbOf(d)) : ""}</p></div>${pickDorm}</div>
  <div class="kpis">
    <div class="kpi lead"><div class="lab">Band / sigʻim</div><div class="val">${I.used}<small>/ ${I.cap}</small></div><div class="gq">Boʻsh joy: ${Math.max(0, I.cap - I.used)}</div></div>
    <div class="kpi"><div class="lab">Yashovchilar</div><div class="val">${I.living.length}</div><div class="gq">Qiz ${qn} · Oʻgʻil ${I.living.length - qn}</div></div>
    <div class="kpi"><div class="lab">Navbatda</div><div class="val">${I.queue.length}</div><div class="gq">joylashtirilishi kerak</div></div>
    <div class="kpi"><div class="lab"><i class="dot" style="background:var(--good)"></i>Bugun bor</div><div class="val">${I.today.bor}</div></div>
    <div class="kpi"><div class="lab"><i class="dot" style="background:var(--ttj)"></i>Uyga ketgan</div><div class="val">${I.today.uy}</div></div>
    <div class="kpi${I.today.sababsiz ? " alert" : ""}"><div class="lab"><i class="dot" style="background:var(--bad)"></i>Sababsiz</div><div class="val">${I.today.sababsiz}</div></div>
    <div class="kpi"><div class="lab"><i class="dot" style="background:var(--none)"></i>Belgilanmagan</div><div class="val">${I.today.un}</div></div>
  </div>
  ${I.left.length ? `<div class="alertbox">${I.left.length} ta talaba xonada turibdi, lekin uning turar joyi oʻzgartirilgan. Xonadan chiqarishni tekshiring: ${I.left.map(sid => esc(I.ids.get(sid)?.n || "oʻchirilgan talaba")).join(", ")}</div>` : ""}
  <div class="tabs" role="tablist">${tabs.map(([k,l]) => `<button class="tab" role="tab" aria-selected="${S.dormTab===k}" data-act="dtab" data-tab="${k}">${l}</button>`).join("")}</div>${body}`;
}
function roomsTab(d, I){
  const rooms = [...(d.rooms || [])].sort((a,b) => (a.fl - b.fl) || String(a.no).localeCompare(String(b.no), "uz", {numeric:true}));
  if (!rooms.length) return `<div class="empty"><h2>Tasdiqlangan xonalar yoʻq</h2><p class="muted">“Qavat va xonalar” boʻlimida qavat va xonalarni qoʻshib, direktor tasdigʻiga yuboring.</p><button class="btn primary" data-act="dtab" data-tab="tuzilma">Qavat va xonalar</button></div>`;
  const floors = groupBy(rooms, r => r.fl);
  const open = S.openRoom && rooms.find(r => r.id === S.openRoom);
  let panel = "";
  if (open){
    const occ = (I.occ[open.id] || []).map(sid => I.ids.get(sid) || {id:sid, n:"(roʻyxatda yoʻq)"});
    const free = (+open.cap || 0) - occ.length;
    const cands = I.queue.filter(s => !open.g || s.g === open.g);
    panel = `<div class="panel"><div class="panel-head"><h2>Xona ${esc(open.no)} · ${open.fl}-qavat</h2><span class="sub">${GL[open.g] ? GL[open.g]+" xonasi · " : ""}${occ.length}/${open.cap} band</span></div>
      ${occ.length ? `<div class="att-list">${occ.map(s => `<div class="att-row"><div class="nm"><b>${esc(s.n)}</b><span>${esc(s.fac || "")} · ${esc(s.gname || "")} · tyutor ${esc(s.tutor || "—")}</span></div>
        <button class="btn sm danger" data-act="unassign" data-sid="${esc(s.id)}" ${S.canWrite ? "" : "disabled"}>Xonadan chiqarish</button></div>`).join("")}</div>` : `<p class="muted">Xona boʻsh.</p>`}
      ${free > 0 ? (cands.length ? `<div class="actions">${selectField("assignpick","Navbatdagi talabani joylashtirish", cands.map(s => [s.id, `${s.n} — ${s.gname}`]), S.pickAssign || "")}
        <button class="btn primary" data-act="assign" data-room="${esc(open.id)}" ${S.canWrite ? "" : "disabled"}>Joylashtirish</button></div>` : `<p class="muted">Navbatda bu xonaga mos talaba yoʻq.</p>`) : `<p class="muted">Xona toʻla.</p>`}
      <div><button class="link" data-act="closeroom">Yopish</button></div></div>`;
  }
  return panel + `<div class="panel"><div class="panel-head"><h2>Xonalar</h2><div class="legend"><span><i class="bed on" style="display:inline-block"></i>Oʻgʻil</span><span><i class="bed on q" style="display:inline-block"></i>Qiz</span><span><i class="bed" style="display:inline-block"></i>Boʻsh joy</span></div></div>
  ${[...floors.entries()].map(([fl, rs]) => `<div class="floor"><h3>${fl}-qavat</h3><div class="rooms">${rs.map(r => {
    const occ = (I.occ[r.id] || []).map(sid => I.ids.get(sid));
    const cap = +r.cap || 0;
    const beds = Array.from({length:Math.max(cap, occ.length)}, (_,i) => { const s = occ[i]; return `<i class="bed${i < occ.length ? " on" : ""}${s && s.g === "Q" ? " q" : ""}"></i>`; }).join("");
    return `<button class="room${occ.length >= cap ? " full" : ""}${S.openRoom===r.id ? " open" : ""}" data-act="openroom" data-room="${esc(r.id)}" aria-label="Xona ${esc(r.no)}, ${occ.length} band, ${cap} sigʻim">
      <div class="no">${esc(r.no)}<small>${r.g === "Q" ? "Qiz" : r.g === "O" ? "Oʻgʻil" : ""}</small></div><div class="beds">${beds}</div></button>`; }).join("")}</div></div>`).join("")}</div>`;
}
function freeRooms(d, I, s){
  return (d.rooms || []).filter(r => (!r.g || r.g === s.g) && (I.occ[r.id] || []).length < (+r.cap || 0))
    .sort((a,b) => (a.fl-b.fl) || String(a.no).localeCompare(String(b.no),"uz",{numeric:true}));
}
function queueTab(d, I){
  const extra = I.unmatched.length ? `<div class="sub">Yana ${I.unmatched.length} ta TTJ talabasining yotoqxonasi aniqlanmadi (yotoqxona nomi yozilmagan).</div>` : "";
  if (!I.queue.length) return `<div class="okbox">Navbat boʻsh: TTJ deb belgilangan barcha talabalar joylashtirilgan.</div>${extra}`;
  return `<div class="panel"><div class="panel-head"><h2>Joylashtirish navbati</h2><span class="sub">“TTJ” deb belgilangan, hali xonaga joylashmagan talabalar</span></div>
  <div class="att-list">${I.queue.map(s => { const fr = freeRooms(d, I, s);
    return `<div class="att-row"><div class="nm"><b>${esc(s.n)}</b><span>${GL[s.g] || ""} · ${esc(s.fac)} · ${esc(s.gname)} · tyutor ${esc(s.tutor || "—")}</span></div>
    <div class="actions">${fr.length ? `<select id="qr_${esc(s.id)}" aria-label="Xona">${fr.map(r => `<option value="${esc(r.id)}">Xona ${esc(r.no)} (${(I.occ[r.id]||[]).length}/${r.cap})</option>`).join("")}</select>
      <button class="btn sm primary" data-act="qassign" data-sid="${esc(s.id)}" ${S.canWrite ? "" : "disabled"}>Joylashtirish</button>` : `<span class="muted">Mos boʻsh xona yoʻq</span>`}</div></div>`; }).join("")}</div>${extra}</div>`;
}
function attTab(d, I){
  if (!I.living.length) return `<div class="empty">Yotoqxonada hali talaba joylashtirilmagan.</div>`;
  const roomOf = sid => (d.rooms || []).find(r => r.id === (d.assign || {})[sid]);
  const byRoom = groupBy(I.living, s => roomOf(s.id)?.no || "—");
  const keys = [...byRoom.keys()].sort((a,b) => String(a).localeCompare(String(b),"uz",{numeric:true}));
  return `<div class="panel"><div class="panel-head"><h2>Yoʻqlama · ${fmtDate(new Date().toISOString())}</h2>
    <div class="actions"><span class="sub">Belgilanmagan: <b class="num">${I.today.un}</b></span><button class="btn primary" data-act="allbor" ${S.canWrite && I.today.un ? "" : "disabled"}>Belgilanmaganlarni “Bor” qilish</button></div></div>
  <div class="legend">${ATT.map(a => `<span><i class="dot" style="background:var(${a.v})"></i>${esc(a.l)}</span>`).join("")}</div>
  <div class="att-list">${keys.map(k => `<div class="att-room">Xona ${esc(k)}</div>${byRoom.get(k).sort((a,b) => a.n.localeCompare(b.n,"uz")).map(s => { const m = I.marks[s.id];
    return `<div class="att-row"><div class="nm"><b>${esc(s.n)}</b><span>${esc(s.fac)} · ${esc(s.gname)}</span></div>
    <div class="seg" role="group" aria-label="${esc(s.n)} holati">${ATT.map(a => `<button data-act="mark" data-sid="${esc(s.id)}" data-st="${a.k}" aria-pressed="${m===a.k}" style="${m===a.k ? `background:var(${a.v})` : ""}" ${S.canWrite ? "" : "disabled"}>${esc(a.l)}</button>`).join("")}</div></div>`; }).join("")}`).join("")}</div></div>`;
}
function dormStats(d, I){
  const facMap = groupBy(I.living, s => s.fac);
  const crs = groupBy(I.living, s => s.course+"-kurs");
  const tbl = (map, label) => `<div class="tbl"><table><thead><tr><th>${label}</th><th class="r">Jami</th><th class="r">Qiz</th><th class="r">Oʻgʻil</th><th class="r">Bugun bor</th><th class="r">Sababsiz</th></tr></thead><tbody>
    ${[...map.entries()].sort((a,b) => String(a[0]).localeCompare(String(b[0]),"uz")).map(([k, arr]) => `<tr><td>${esc(k)}</td><td class="r num">${arr.length}</td><td class="r num">${arr.filter(s=>s.g==="Q").length}</td><td class="r num">${arr.filter(s=>s.g==="O").length}</td><td class="r num">${arr.filter(s=>I.marks[s.id]==="bor").length}</td><td class="r num">${arr.filter(s=>I.marks[s.id]==="sababsiz").length}</td></tr>`).join("")}</tbody></table></div>`;
  return `<div class="grid2"><div class="panel"><h2>Fakultetlar kesimida</h2>${tbl(facMap, "Fakultet")}</div><div class="panel"><h2>Kurslar kesimida</h2>${tbl(crs, "Kurs")}</div></div>
  ${I.streak.length ? `<div class="alertbox"><b>3 kun ketma-ket sababsiz yoʻq:</b> ${I.streak.map(s => esc(s.n)+" ("+esc(s.gname)+")").join("; ")}. Tyutor va maʼnaviyat boʻlimiga xabar bering.</div>` : ""}`;
}


/* ----- dorm structure: the tarbiyachi edits a draft, the director approves it ----- */
function roomDiff(d, rooms){
  const old = new Map((d.rooms || []).map(r => [r.id, r]));
  const now = new Map(rooms.map(r => [r.id, r]));
  const added = rooms.filter(r => !old.has(r.id));
  const removed = (d.rooms || []).filter(r => !now.has(r.id));
  const changed = rooms.filter(r => old.has(r.id) && (old.get(r.id).cap !== r.cap || (old.get(r.id).g || "") !== (r.g || "") || old.get(r.id).no !== r.no || old.get(r.id).fl !== r.fl));
  const capBefore = (d.rooms || []).reduce((a,r) => a + (+r.cap||0), 0), capAfter = rooms.reduce((a,r) => a + (+r.cap||0), 0);
  const floors = rs => new Set(rs.map(r => r.fl)).size;
  return {added, removed, changed, capBefore, capAfter, flBefore:floors(d.rooms || []), flAfter:floors(rooms), any: added.length + removed.length + changed.length > 0, old};
}
const statusChip = d => {
  const st = d.draft && d.draft.status;
  if (st === "pending") return `<span class="chip demo">Tasdiq kutilmoqda</span>`;
  if (st === "rejected") return `<span class="chip" style="color:var(--bad)">Rad etilgan</span>`;
  if (st === "draft") return `<span class="chip">Qoralama saqlangan</span>`;
  return `<span class="chip" style="color:var(--good)">Joriy tuzilma tasdiqlangan</span>`;
};
function ensureDraft(d){
  if (S.draftDorm !== d.id || !S.draft){
    S.draft = JSON.parse(JSON.stringify(d.draft ? d.draft.rooms : (d.rooms || [])));
    S.draftDorm = d.id; S.draftDirty = false; S.extraFloors = [];
  }
  return S.draft;
}
function diffSummary(d, rooms){
  const df = roomDiff(d, rooms);
  if (!df.any) return `<p class="muted">Joriy tuzilmadan farq yoʻq.</p>`;
  const list = (arr, fn) => arr.map(fn).join(", ");
  return `<div class="kpis">
    <div class="kpi"><div class="lab">Qavatlar</div><div class="val">${df.flAfter}<small>avval ${df.flBefore}</small></div></div>
    <div class="kpi"><div class="lab">Xonalar</div><div class="val">${rooms.length}<small>avval ${(d.rooms||[]).length}</small></div></div>
    <div class="kpi lead"><div class="lab">Umumiy sigʻim</div><div class="val">${df.capAfter}<small>avval ${df.capBefore}</small></div></div></div>
    ${df.added.length ? `<div class="okbox"><b>Qoʻshiladi (${df.added.length}):</b> ${list(df.added, r => `${esc(r.no)} (${r.fl}-qavat, ${r.cap} oʻrin${r.g ? ", "+GL[r.g] : ""})`)}</div>` : ""}
    ${df.changed.length ? `<div class="note"><b>Oʻzgaradi (${df.changed.length}):</b> ${list(df.changed, r => { const o = df.old.get(r.id); return `${esc(r.no)}: ${o.cap}→${r.cap} oʻrin${(o.g||"") !== (r.g||"") ? `, ${GL[o.g] || "aralash"}→${GL[r.g] || "aralash"}` : ""}`; })}</div>` : ""}
    ${df.removed.length ? `<div class="alertbox"><b>Olib tashlanadi (${df.removed.length}):</b> ${list(df.removed, r => esc(r.no))}</div>` : ""}`;
}
function dormEditTab(d){
  const st = d.draft && d.draft.status;
  const I = dormInfo(d);
  if (st === "pending"){
    return `<div class="panel"><div class="panel-head"><h2>Qavat va xonalar</h2>${statusChip(d)}</div>
      <p class="muted">${esc(d.draft.by)} ${fmtDate(d.draft.at)} kuni yuborgan oʻzgarishlar direktor tasdigʻini kutmoqda. Tasdiqlangunga qadar joriy tuzilma amalda.</p>
      ${diffSummary(d, d.draft.rooms)}
      <div class="actions"><button class="btn" data-act="withdraw">Soʻrovni qaytarib olish</button></div></div>`;
  }
  const rooms = ensureDraft(d);
  const floors = uniq([...rooms.map(r => r.fl), ...S.extraFloors].map(Number)).map(Number).sort((a,b) => a-b);
  const occupied = rid => (I.occ[rid] || []).length;
  const ro = !S.canWrite;
  const floorBlock = fl => {
    const rs = rooms.filter(r => r.fl === fl).sort((a,b) => String(a.no).localeCompare(String(b.no),"uz",{numeric:true}));
    return `<div class="floor"><h3>${fl}-qavat · ${rs.length} xona · ${rs.reduce((a,r) => a + (+r.cap||0), 0)} oʻrin</h3>
      <div class="tbl"><table><thead><tr><th>Xona</th><th>Sigʻim</th><th>Kimlar uchun</th><th>Hozir yashaydi</th><th></th></tr></thead><tbody>
      ${rs.map(r => `<tr><td class="num"><b>${esc(r.no)}</b></td>
        <td><input type="number" min="1" max="20" id="cap_${esc(r.id)}" data-room-cap="${esc(r.id)}" value="${r.cap}" style="width:70px" ${ro ? "disabled" : ""}></td>
        <td><select id="g_${esc(r.id)}" data-room-g="${esc(r.id)}" ${ro ? "disabled" : ""}><option value="" ${!r.g ? "selected" : ""}>Aralash</option><option value="O" ${r.g==="O" ? "selected" : ""}>Oʻgʻil</option><option value="Q" ${r.g==="Q" ? "selected" : ""}>Qiz</option></select></td>
        <td class="num">${occupied(r.id)}</td>
        <td>${occupied(r.id) ? `<span class="muted" style="font-size:12px">bandligi uchun oʻchirilmaydi</span>` : `<button class="btn sm danger" data-act="rmroom" data-rid="${esc(r.id)}" ${ro ? "disabled" : ""}>Olib tashlash</button>`}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="actions">
        <div class="field"><label for="nr_no_${fl}">Xona raqami</label><input type="text" id="nr_no_${fl}" style="width:100px" placeholder="${fl}${pad(rs.length+1)}"></div>
        <div class="field"><label for="nr_cap_${fl}">Sigʻim</label><input type="number" id="nr_cap_${fl}" min="1" max="20" value="4" style="width:70px"></div>
        <div class="field"><label for="nr_g_${fl}">Kimlar uchun</label><select id="nr_g_${fl}"><option value="">Aralash</option><option value="O">Oʻgʻil</option><option value="Q">Qiz</option></select></div>
        <button class="btn" data-act="addroom" data-fl="${fl}" style="align-self:end" ${ro ? "disabled" : ""}>Xona qoʻshish</button></div></div>`;
  };
  const nextFl = floors.length ? Math.max(...floors) + 1 : 1;
  return `<div class="panel"><div class="panel-head"><h2>Qavat va xonalar</h2>${statusChip(d)}</div>
    <p class="muted">Oʻzgarishlar qoralama sifatida saqlanadi va direktor tasdiqlagandan keyin joriy etiladi. Ungacha talabalar eski tuzilma boʻyicha joylashtiriladi.</p>
    ${st === "rejected" ? `<div class="alertbox"><b>Rad etildi${d.draft.decidedBy ? " ("+esc(d.draft.decidedBy)+")" : ""}:</b> ${esc(d.draft.note || "izohsiz")}. Tuzatib, qayta yuboring.</div>` : ""}
    ${floors.length ? floors.map(floorBlock).join("") : `<p class="muted">Hali xona yoʻq. Birinchi qavatni qoʻshing.</p>`}
    <div class="panel" style="background:var(--sunk)"><h2 style="font-size:14px">Yangi qavat qoʻshish</h2>
      <div class="actions">
        <div class="field"><label for="nf_fl">Qavat</label><input type="number" id="nf_fl" min="0" max="40" value="${nextFl}" style="width:70px"></div>
        <div class="field"><label for="nf_cnt">Xonalar soni</label><input type="number" id="nf_cnt" min="1" max="60" value="10" style="width:80px"></div>
        <div class="field"><label for="nf_cap">Har biri sigʻimi</label><input type="number" id="nf_cap" min="1" max="20" value="4" style="width:70px"></div>
        <div class="field"><label for="nf_g">Kimlar uchun</label><select id="nf_g"><option value="">Aralash</option><option value="O">Oʻgʻil</option><option value="Q">Qiz</option></select></div>
        <button class="btn" data-act="addfloor" style="align-self:end" ${ro ? "disabled" : ""}>Qavatni xonalari bilan qoʻshish</button></div>
      <p class="sub">Xonalar avtomatik raqamlanadi: masalan 5-qavatda 501, 502, … Keyin har birini alohida oʻzgartirish mumkin.</p></div>
    <h2 style="font-size:14px">Joriy tuzilmaga nisbatan</h2>${diffSummary(d, rooms)}
    <div class="actions"><button class="btn" data-act="savedraft" ${ro || !S.draftDirty ? "disabled" : ""}>Qoralamani saqlash</button>
      <button class="btn primary" data-act="submitdraft" ${ro || !roomDiff(d, rooms).any ? "disabled" : ""}>Direktor tasdigʻiga yuborish</button>
      ${d.draft ? `<button class="link" data-act="discarddraft">Qoralamani bekor qilish</button>` : ""}</div></div>`;
}
function approveView(){
  const list = pendingApprovals();
  if (!list.length) return `<div class="okbox">Tasdiqlashni kutayotgan oʻzgarish yoʻq.</div>`;
  return list.map(d => `<div class="panel"><div class="panel-head"><div><h2>${esc(d.name)}</h2><div class="sub">${esc(d.draft.by)} · ${fmtDate(d.draft.at)}${tarbOf(d) ? " · tarbiyachi: "+esc(tarbOf(d)) : ""}</div></div>${statusChip(d)}</div>
    ${diffSummary(d, d.draft.rooms)}
    <div class="field" style="max-width:560px"><label for="note_${esc(d.id)}">Rad etish sababi (rad etsangiz)</label><input type="text" id="note_${esc(d.id)}" data-note="${esc(d.id)}" value="${esc(S.decideNote[d.id] || "")}" placeholder="Masalan: 3-qavat qizlar uchun boʻlishi kerak"></div>
    <div class="actions"><button class="btn primary" data-act="approve" data-did="${esc(d.id)}">Tasdiqlash va joriy etish</button><button class="btn danger" data-act="rejectdraft" data-did="${esc(d.id)}">Rad etish</button></div></div>`).join("");
}

/* ----- structure: faculties, groups, tutors, dorms ----- */
function structView(){
  const facs = faculties();
  const groups = [...S.groups.values()];
  const byFac = groupBy(groups, g => g.fac);
  const people = [...S.people].sort((a,b) => a.name.localeCompare(b.name, "uz"));
  const tutorUid = gid => { for (const st of S.staff.values()) if (st.grp && (st.groups||[]).includes(gid)) return st.id; return ""; };
  const tutorName = gid => (S.tutors[gid] || []).join(", ");
  const fFac = S.structFac && facs.includes(S.structFac) ? S.structFac : "";
  const shown = groups.filter(g => !fFac || g.fac === fFac).sort((a,b) => String(a.fac).localeCompare(String(b.fac),"uz") || String(a.course).localeCompare(String(b.course)) || String(a.name).localeCompare(String(b.name),"uz",{numeric:true}));
  const canPick = S.perms.users || S.staff.size > 0;
  const tutorSel = (id, gid, val) => `<select id="${id}" ${gid ? `data-gtutor="${esc(gid)}"` : ""}><option value="">— biriktirilmagan —</option>${people.map(p => `<option value="${esc(p.id)}" ${p.id === val ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>`;
  const facRows = facs.map(f => { const gs = byFac.get(f) || []; const n = gs.reduce((a,g) => a + (g.students||[]).length, 0);
    return `<div class="urow"><div class="nm">${S.renameFac === f ? `<input type="text" id="rn_fac" value="${esc(f)}" style="width:280px">` : `<b>${esc(f)}</b>`}<span class="muted" style="font-size:12px">${gs.length} guruh · ${n} talaba</span></div>
      <div class="actions">${S.renameFac === f ? `<button class="btn sm primary" data-act="dorename" data-fac="${esc(f)}">Saqlash</button><button class="btn sm" data-act="cancelrename">Bekor</button>`
        : `<button class="btn sm" data-act="renamefac" data-fac="${esc(f)}">Nomini oʻzgartirish</button>${gs.length ? "" : `<button class="btn sm danger" data-act="delfac" data-fac="${esc(f)}">Oʻchirish</button>`}`}</div></div>`; }).join("");
  return `<div class="panel"><div class="panel-head"><h2>Fakultetlar</h2><span class="sub">${facs.length} ta</span></div>
    <div class="actions"><div class="field" style="min-width:min(100%,320px)"><label for="nfac">Yangi fakultet</label><input type="text" id="nfac" placeholder="Masalan: Amaliy matematika"></div><button class="btn primary" data-act="addfac" style="align-self:end">Qoʻshish</button></div>
    <div class="ulist">${facRows || `<p class="muted">Hali fakultet yoʻq.</p>`}</div></div>

  <div class="panel"><div class="panel-head"><h2>Guruhlar va tyutorlar</h2><span class="sub">${groups.length} guruh</span></div>
    ${!people.length ? `<div class="note">Tyutor biriktirish uchun avval “Foydalanuvchilar” boʻlimida tyutorga hisob oching (yoki u oʻzi soʻrov yuborsin va siz tasdiqlang).</div>` : ""}
    <div class="panel" style="background:var(--sunk)"><h2 style="font-size:14px">Yangi guruh</h2>
      <div class="actions">${selectField("ng_fac","Fakultet", facs.map(f => [f,f]), fFac)}
        <div class="field"><label for="ng_course">Kurs</label><select id="ng_course">${[1,2,3,4,5,6].map(c => `<option value="${c}">${c}-kurs</option>`).join("")}</select></div>
        <div class="field"><label for="ng_name">Guruh nomi</label><input type="text" id="ng_name" placeholder="261-24" style="width:120px"></div>
        <div class="field"><label for="ng_tutor">Tyutor</label>${tutorSel("ng_tutor", "", "")}</div>
        <button class="btn primary" data-act="addgroup" style="align-self:end">Guruh qoʻshish</button></div></div>
    <div class="filters">${selectField("structfac","Koʻrsatish", facs.map(f => [f,f]), fFac, "Barcha fakultetlar")}</div>
    <div class="tbl"><table><thead><tr><th>Guruh</th><th>Fakultet</th><th>Kurs</th><th class="r">Talaba</th><th>Tyutor</th><th></th></tr></thead><tbody>
    ${shown.map(g => `<tr><td class="num"><b>${esc(g.name)}</b></td><td>${esc(g.fac)}</td><td>${esc(g.course)}</td><td class="r num">${(g.students||[]).length}</td>
      <td>${S.perms.users ? tutorSel("gt_"+g.id, g.id, tutorUid(g.id)) : esc(tutorName(g.id) || g.tutor || "—")}${!tutorName(g.id) && g.tutor ? `<div class="muted" style="font-size:12px">Excel'da: ${esc(g.tutor)}</div>` : ""}</td>
      <td><div class="actions">${S.addStu === g.id ? "" : `<button class="btn sm" data-act="addstu" data-gid="${esc(g.id)}">Talaba qoʻshish</button>`}${(g.students||[]).length ? "" : `<button class="btn sm danger" data-act="delgroup" data-gid="${esc(g.id)}">Oʻchirish</button>`}</div></td></tr>
      ${S.addStu === g.id ? `<tr><td colspan="6"><div class="actions">
        <div class="field"><label for="ns_n">Familiya va ism</label><input type="text" id="ns_n" style="width:240px"></div>
        <div class="field"><label for="ns_g">Jinsi</label><select id="ns_g"><option value="O">Oʻgʻil</option><option value="Q">Qiz</option></select></div>
        <div class="field"><label for="ns_vil">Viloyat</label><input type="text" id="ns_vil" style="width:150px"></div>
        <div class="field"><label for="ns_tum">Tuman</label><input type="text" id="ns_tum" style="width:150px"></div>
        <div class="field"><label for="ns_ph">Telefon</label><input type="text" id="ns_ph" style="width:140px"></div>
        <button class="btn primary sm" data-act="savestu" data-gid="${esc(g.id)}" style="align-self:end">Qoʻshish</button><button class="btn sm" data-act="cancelstu" style="align-self:end">Yopish</button></div></td></tr>` : ""}`).join("")}
    </tbody></table></div>
    ${!S.perms.users ? `<p class="sub">Tyutorni almashtirish uchun “Foydalanuvchilar va huquqlar” vazifasi ham kerak.</p>` : ""}</div>

  <div class="panel"><div class="panel-head"><h2>Yotoqxonalar</h2><span class="sub">${S.dorms.size} ta</span></div>
    <div class="actions"><div class="field"><label for="ndorm">Yangi yotoqxona</label><input type="text" id="ndorm" placeholder="3-TTJ" style="width:160px"></div><button class="btn primary" data-act="adddorm" style="align-self:end">Qoʻshish</button></div>
    <div class="ulist">${dormList().map(d => `<div class="urow"><div class="nm"><b>${esc(d.name)}</b><span class="muted" style="font-size:12px">${(d.rooms||[]).length} xona · ${(d.rooms||[]).reduce((a,r) => a + (+r.cap||0), 0)} oʻrin · tarbiyachi: ${esc(tarbOf(d) || "biriktirilmagan")}</span></div>${statusChip(d)}</div>`).join("") || `<p class="muted">Hali yotoqxona yoʻq.</p>`}</div>
    <p class="sub">Tarbiyachi-pedagogga yotoqxonani “Foydalanuvchilar” boʻlimida “Yotoqxonani boshqarish” vazifasi orqali biriktirasiz. Qavat va xonalarni tarbiyachi qoʻshadi, siz “Tasdiqlash” boʻlimida joriy etasiz.</p></div>`;
}

/* ----- users & rights ----- */
function usersView(){
  if (S.edit) return editView();
  const reqs = [...S.requests.values()].sort((a,b) => String(b.at).localeCompare(String(a.at)));
  const staff = [...S.staff.values()].sort((a,b) => String(a.name).localeCompare(String(b.name), "uz"));
  const allow = S.settings ? S.settings.allowRegister : true;
  return `<div class="actions"><button class="btn primary" data-act="newuser">Yangi hisob ochish</button>
    <label class="ck" style="margin-left:auto"><input type="checkbox" id="allowreg" data-setting="allowRegister" ${allow ? "checked" : ""}><span><b>Xodimlar oʻzi soʻrov yubora olsin</b><span>Oʻchirsangiz, hisoblarni faqat siz ochasiz</span></span></label></div>
  <div class="panel"><div class="panel-head"><h2>Kirish soʻrovlari</h2><span class="sub">${reqs.length ? reqs.length+" ta kutmoqda" : "Yangi soʻrov yoʻq"}</span></div>
    ${reqs.length ? `<div class="ulist">${reqs.map(r => `<div class="urow"><div class="nm"><b>${esc(r.name)}</b><span class="muted" style="font-size:12px">login: ${esc(r.username)} · ${fmtDate(r.at)}</span></div>
      <div class="actions">${S.confirm === "rej:"+r.id ? `<span class="sub">Soʻrov va hisob oʻchirilsinmi?</span><button class="btn danger sm" data-act="dorevoke" data-uid="${esc(r.id)}">Ha, rad etish</button><button class="btn sm" data-act="cancel">Bekor</button>`
        : `<button class="btn primary sm" data-act="grant" data-uid="${esc(r.id)}">Huquq berish</button><button class="btn sm" data-act="askreject" data-uid="${esc(r.id)}">Rad etish</button>`}</div></div>`).join("")}</div>`
      : `<p class="muted">Xodim tizim manzilini ochib, “Hisobim yoʻq — soʻrov yuborish” orqali hisob ochadi. Soʻrov shu yerda paydo boʻladi. Yoki “Yangi hisob ochish” orqali hisobni oʻzingiz yarating.</p>`}</div>
  <div class="panel"><div class="panel-head"><h2>Foydalanuvchilar</h2><span class="sub">${staff.length} kishi</span></div>
    ${staff.length ? `<div class="ulist">${staff.map(s => `<div class="urow"><div class="nm"><b>${esc(s.name)}</b><span class="muted" style="font-size:12px">login: ${esc(s.username)}</span>${rightsChips(s)}</div>
      <div class="actions">${s.id === S.me.id ? `<span class="sub">Bu sizning hisobingiz</span>` : S.confirm === "rm:"+s.id ? `<span class="sub">Hisob va barcha huquqlar oʻchirilsinmi?</span><button class="btn danger sm" data-act="dorevoke" data-uid="${esc(s.id)}">Ha, oʻchirish</button><button class="btn sm" data-act="cancel">Bekor</button>`
        : `<button class="btn sm" data-act="editu" data-uid="${esc(s.id)}">Huquqlarni oʻzgartirish</button><button class="btn sm danger" data-act="askrevoke" data-uid="${esc(s.id)}">Hisobni oʻchirish</button>`}</div></div>`).join("")}</div>`
      : `<p class="muted">Hali hech kimga huquq berilmagan.</p>`}</div>`;
}
function editView(){
  const e = S.edit;
  const facs = faculties();
  const tutorsXl = uniq([...S.groups.values()].map(g => g.tutor));
  const ck = (scope, v, label, sub) => `<label class="ck"><input type="checkbox" data-esc="${scope}" value="${esc(v)}" ${e[scope].includes(v) ? "checked" : ""}><span><b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</span></label>`;
  const groupsByFac = groupBy([...S.groups.values()], g => g.fac);
  const scopeBox = k => {
    if (k === "facs") return facs.length ? `<div class="checks">${facs.map(f => ck("facs", f, f)).join("")}</div>` : `<p class="muted">Fakultetlar hali qoʻshilmagan.</p>`;
    if (k === "groups") return `<div class="actions">${tutorsXl.length ? selectField("e_tut", "Excel'dagi tyutor ismi boʻyicha belgilash", tutorsXl.map(t => [t,t]), "") : ""}<span class="sub">${e.groups.length} ta guruh belgilangan</span></div>
      <div class="checks">${[...groupsByFac.entries()].sort((a,b) => String(a[0]).localeCompare(String(b[0]),"uz")).map(([f, gs]) => `<div class="facgrp" style="grid-column:1/-1"><h4>${esc(f)}</h4></div>${gs.sort((a,b) => String(a.name).localeCompare(String(b.name),"uz",{numeric:true})).map(g => ck("groups", g.id, g.name, `${g.course}-kurs · ${(g.students||[]).length} talaba`)).join("")}`).join("")}</div>`;
    if (k === "dorms") return S.dorms.size ? `<div class="checks">${dormList().map(d => ck("dorms", d.id, d.name, d.branch || "")).join("")}</div>` : `<p class="muted">Yotoqxonalar hali qoʻshilmagan.</p>`;
    return "";
  };
  return `<div class="actions"><button class="btn sm" data-act="closeedit">← Foydalanuvchilar</button></div>
  <div class="panel"><div class="panel-head"><h2>${e.create ? "Yangi hisob" : e.isNew ? "Huquq berish" : "Huquqlarni oʻzgartirish"}</h2>${e.username && !e.create ? `<span class="sub">login: ${esc(e.username)}</span>` : ""}</div>
    <div class="actions">
      <div class="field" style="min-width:min(100%,300px)"><label for="e_name">Ism va familiya</label><input type="text" id="e_name" data-in="e_name" value="${esc(e.name)}"></div>
      ${e.create ? `<div class="field"><label for="e_user">Login</label><input type="text" id="e_user" data-in="e_user" value="${esc(e.username)}" autocapitalize="none" spellcheck="false"></div>` : ""}
      ${e.create ? `<div class="field"><label for="e_pass">Parol</label><input type="text" id="e_pass" data-in="e_pass" value="${esc(e.password)}" autocomplete="off" placeholder="kamida 8 belgi, harf va raqam"></div>` : `<p class="sub" style="align-self:end">Parolni xodimning oʻzi “Parol” tugmasi orqali oʻzgartiradi. Unutsa: Firebase Console → Authentication.</p>`}
    </div>
    <div>${PERMS.map(pm => `<div class="perm"><label class="ck"><input type="checkbox" data-eflag="${pm.k}" ${e[pm.k] ? "checked" : ""}><span><b>${esc(pm.l)}</b><span>${esc(pm.d)}</span></span></label>
      ${pm.scope && e[pm.k] ? scopeBox(pm.scope) : ""}</div>`).join("")}</div>
    ${S.editErr ? `<div class="alertbox">${esc(S.editErr)}</div>` : ""}
    <div class="actions"><button class="btn primary" data-act="saveu">${e.create ? "Hisobni ochish" : e.isNew ? "Huquq berish va kirishni ochish" : "Saqlash"}</button><button class="btn" data-act="closeedit">Bekor qilish</button></div>
  </div>`;
}
function openEdit(uid, isNew){
  const s = (uid && (S.staff.get(uid) || S.requests.get(uid))) || {};
  S.edit = {uid, isNew, create:!uid, name:s.name || "", username:s.username || "", password:"",
    stat_all:!!s.stat_all, stat_fac:!!s.stat_fac, facs:[...(s.facs||[])], grp:!!s.grp, groups:[...(s.groups||[])],
    dorm:!!s.dorm, dorms:[...(s.dorms||[])], struct:!!s.struct, approve:!!s.approve, import:!!s.import, users:!!s.users};
  S.editErr = "";
}
async function saveEdit(){
  const e = S.edit;
  if (e.name.trim().split(/\s+/).length < 2){ S.editErr = "Ism va familiyani toʻliq yozing."; return render(); }
  if (e.stat_fac && !e.facs.length){ S.editErr = "Fakultet statistikasi uchun kamida bitta fakultetni belgilang."; return render(); }
  if (e.grp && !e.groups.length){ S.editErr = "Turar joy kiritish uchun kamida bitta guruhni belgilang."; return render(); }
  if (e.dorm && !e.dorms.length){ S.editErr = "Kamida bitta yotoqxonani belgilang."; return render(); }
  if (!PERMS.some(pm => e[pm.k])){ S.editErr = "Kamida bitta vazifani belgilang."; return render(); }
  const body = {uid:e.uid || undefined, name:e.name.trim(), username:e.create ? e.username : undefined, password:e.password || undefined,
    stat_all:e.stat_all, stat_fac:e.stat_fac, facs:e.stat_fac ? e.facs : [], grp:e.grp, groups:e.grp ? e.groups : [],
    dorm:e.dorm, dorms:e.dorm ? e.dorms : [], struct:e.struct, approve:e.approve, import:e.import, users:e.users};
  try { await api("/api/staff", body); } catch (err){ S.editErr = err.error; return render(); }
  toast(e.create ? `${body.name} uchun hisob ochildi.` : e.isNew ? `${body.name} uchun kirish ochildi.` : "Huquqlar saqlandi.");
  S.edit = null; await loadState();
}

/* ----- import / admin ----- */
function importView(){
  const ro = !S.canWrite;
  const imp = S.imp;
  let preview = "";
  if (imp){
    preview = `<div class="panel"><h2>Faylni tekshirish: ${esc(imp.file)}</h2>
      <div class="kpis">${[["Talabalar", imp.students],["Guruhlar", imp.groups.length],["Fakultetlar", imp.facs],["Tyutorlar", imp.tutors],["Yotoqxonalar", imp.dorms.length],["Xonalar", imp.rooms]].map(([l,v]) => `<div class="kpi"><div class="lab">${l}</div><div class="val">${v}</div></div>`).join("")}</div>
      ${imp.warn.length ? `<div class="alertbox"><b>Eʼtibor bering:</b><ul style="margin:6px 0 0;padding-left:18px">${imp.warn.slice(0,8).map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>` : `<div class="okbox">Xato topilmadi.</div>`}
      ${imp.students ? (S.confirm === "import" ? `<div class="alertbox">Bazadagi barcha talabalar, yotoqxonalar va yoʻqlamalar oʻchirilib, shu fayl bilan almashtiriladi. Foydalanuvchilar va huquqlar saqlanib qoladi, lekin guruh va yotoqxona biriktirishlarini qayta belgilash kerak boʻladi.<div class="actions" style="margin-top:8px"><button class="btn primary" data-act="doimport">Ha, almashtirish</button><button class="btn" data-act="cancel">Bekor qilish</button></div></div>`
        : `<div class="actions"><button class="btn primary" data-act="askimport" ${ro ? "disabled" : ""}>Bazaga yozish</button><button class="btn" data-act="dropimp">Boshqa fayl</button></div>`) : ""}</div>`;
  }
  return `<div class="panel"><div class="panel-head"><h2>Excel'dan yuklash</h2><a class="btn sm" href="TalabaMakon_import_shabloni.xlsx" download>Shablonni yuklab olish</a></div>
    <p class="muted" style="max-width:68ch">“Talabalar” varagʻida har bir talaba bitta qator. “TTJ xonalari” varagʻida har bir xona bitta qator. NAMUNA bilan boshlanadigan qatorlar oʻtkazib yuboriladi.</p>
    <div class="actions"><input type="file" id="xfile" accept=".xlsx,.xls" data-ch="xfile" ${ro ? "disabled" : ""}></div>
    ${S.busy ? `<p class="num">${esc(S.busy)}</p>` : ""}</div>
  ${preview}
  <div class="panel"><h2>Bazani boshqarish</h2>
    <p class="muted">Hozir bazada: <b class="num">${allStudents().length}</b> talaba, <b class="num">${S.groups.size}</b> guruh, <b class="num">${S.dorms.size}</b> yotoqxona${S.org?.source === "demo" ? " (namuna maʼlumot)" : ""}.</p>
    ${S.confirm === "demo" ? `<div class="alertbox">Bazadagi joriy talabalar va yotoqxonalar oʻchirilib, oʻrniga namuna maʼlumot yoziladi.<div class="actions" style="margin-top:8px"><button class="btn primary" data-act="demo">Ha, namunani yuklash</button><button class="btn" data-act="cancel">Bekor qilish</button></div></div>`
      : S.confirm === "clear" ? `<div class="alertbox">Barcha talabalar, yotoqxonalar va yoʻqlamalar oʻchiriladi. Buni qaytarib boʻlmaydi.<div class="actions" style="margin-top:8px"><button class="btn danger" data-act="doclear">Ha, hammasini oʻchirish</button><button class="btn" data-act="cancel">Bekor qilish</button></div></div>`
      : `<div class="actions"><button class="btn" data-act="demo" ${ro ? "disabled" : ""}>Namuna maʼlumotni yuklash</button><button class="btn danger" data-act="askclear" ${ro ? "disabled" : ""}>Bazani tozalash</button></div>`}
  </div>`;
}

function findCol(headers, ...keys){
  const hs = headers.map(h => [h, norm(h)]);
  for (const k of keys){ const f = hs.find(([,n]) => n.includes(k)); if (f) return f[0]; }
  return null;
}
const normType = v => { const n = norm(v); if (!n) return ""; if (n.includes("ttj") || n.includes("yotoq")) return "TTJ"; if (n.includes("ijara")) return "Ijara"; if (n.includes("qarindosh")) return "Qarindosh"; if (n.includes("uy")) return "Uy"; return null; };
const normG = v => { const n = norm(v); if (!n) return ""; if (n.startsWith("q") || n.startsWith("ayol") || n === "f" || n.startsWith("ж")) return "Q"; if (n.startsWith("o") || n.startsWith("erkak") || n === "m" || n.startsWith("м")) return "O"; return null; };

function toObjs(rows){
  const hdr = (rows[0] || []).map(x => String(x).trim());
  return rows.slice(1).map(r => { const o = {}; hdr.forEach((k, i) => { if (k) o[k] = r[i] ?? ""; }); return o; }).filter(o => Object.values(o).some(v => String(v).trim()));
}
function parseWorkbook(book, fileName){
  const wb = {SheetNames: book.names};
  const sName = wb.SheetNames.find(n => norm(n).includes("talaba")) || wb.SheetNames.find(n => !norm(n).includes("yoriq") && !norm(n).includes("xona")) || wb.SheetNames[0];
  const rows = toObjs(book.sheets[sName] || []);
  const warn = [];
  const H = rows.length ? Object.keys(rows[0]) : [];
  const C = {
    branch: findCol(H, "filial"), fac: findCol(H, "fakultet"), course: findCol(H, "kurs"), grp: findCol(H, "guruh"),
    tutor: findCol(H, "tyutor"), name: findCol(H, "talaba", "fish", "f.i.sh"), g: findCol(H, "jins"), ph: findCol(H, "telefon"),
    vil: findCol(H, "viloyat"), tum: findCol(H, "tuman"), rt: findCol(H, "turi"), ra: findCol(H, "manzil"), iz: findCol(H, "izoh")
  };
  for (const k of ["fac","grp","name"]) if (!C[k]) warn.push(`“${{fac:"Fakultet",grp:"Guruh",name:"Talaba F.I.Sh."}[k]}” ustuni topilmadi.`);
  const groups = new Map(); let n = 0, skipped = 0;
  const v = (r, k) => C[k] ? String(r[C[k]] ?? "").trim() : "";
  rows.forEach((r, i) => {
    const name = v(r, "name");
    if (!name || norm(name).startsWith("namuna")) { if (!name && Object.values(r).some(x => String(x).trim())) skipped++; return; }
    const fac = v(r, "fac") || "Fakultet koʻrsatilmagan", grp = v(r, "grp") || "Guruhsiz", branch = v(r, "branch"), course = v(r, "course").replace(/\D/g,"") || "";
    const key = [branch, fac, course, grp].join("|");
    const gid = "g" + hash(key);
    if (!groups.has(gid)) groups.set(gid, {id:gid, name:grp, fac, course, branch, tutor:v(r, "tutor"), students:[]});
    const gr = groups.get(gid);
    if (!gr.tutor && v(r,"tutor")) gr.tutor = v(r,"tutor");
    let rt = normType(v(r, "rt")); if (rt === null){ warn.push(`${i+2}-qator: “${v(r,"rt")}” turar joy turi tanilmadi — “Kiritilmagan” qilindi.`); rt = ""; }
    let g = normG(v(r, "g")); if (g === null){ warn.push(`${i+2}-qator: jinsi “${v(r,"g")}” tanilmadi.`); g = ""; }
    gr.students.push({id:"s"+hash(gid+"|"+name+"|"+i), n:name, g, ph:v(r,"ph"), vil:v(r,"vil"), tum:v(r,"tum"), rt, ra:v(r,"ra"), iz:v(r,"iz"), up:""});
    n++;
  });
  if (skipped) warn.push(`${skipped} ta qatorda talaba ismi yoʻq — oʻtkazib yuborildi.`);
  const noTutor = [...groups.values()].filter(g => !g.tutor).length;
  if (noTutor) warn.push(`${noTutor} ta guruhga tyutor yozilmagan.`);
  const dorms = new Map(); let roomCount = 0;
  const rName = wb.SheetNames.find(x => norm(x).includes("ttj") || norm(x).includes("xona"));
  if (rName){
    const rr = toObjs(book.sheets[rName] || []);
    const RH = rr.length ? Object.keys(rr[0]) : [];
    const R = {branch:findCol(RH,"filial"), dorm:findCol(RH,"yotoqxona","ttj"), tarb:findCol(RH,"tarbiyachi"), fl:findCol(RH,"qavat"), no:findCol(RH,"xona raqam","raqam","xona no","№"), cap:findCol(RH,"sigim","sig"), g:findCol(RH,"jins")};
    const rv = (r,k) => R[k] ? String(r[R[k]] ?? "").trim() : "";
    for (const r of rr){
      const dn = rv(r,"dorm"), no = rv(r,"no");
      if (!dn || !no || norm(rv(r,"tarb")).startsWith("namuna")) continue;
      const did = "d" + hash(rv(r,"branch")+"|"+dn);
      if (!dorms.has(did)) dorms.set(did, {id:did, name:dn, branch:rv(r,"branch"), tarb:rv(r,"tarb"), rooms:[], assign:{}});
      const D = dorms.get(did);
      if (D.rooms.some(x => x.no === no)) continue;
      D.rooms.push({id:"r"+hash(did+"|"+no), fl:+rv(r,"fl") || 1, no, cap:+rv(r,"cap") || 0, g:normG(rv(r,"g")) || ""});
      roomCount++;
    }
  } else warn.push("“TTJ xonalari” varagʻi topilmadi — yotoqxonalar yuklanmaydi.");
  const all = [...groups.values()];
  return {file:fileName, groups:all, dorms:[...dorms.values()], students:n, facs:new Set(all.map(g => g.fac)).size, tutors:new Set(all.map(g => g.tutor).filter(Boolean)).size, rooms:roomCount, warn};
}

/* demo data — clearly marked as sample */
function makeDemo(){
  let seed = 20261104; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd()*a.length)];
  const M = ["Aziz","Bekzod","Doniyor","Eldor","Farrux","Jasur","Javohir","Islom","Sardor","Shohruh","Ulugʻbek","Otabek","Sherzod","Behruz","Asilbek","Abdulloh","Ibrohim","Nodir","Jahongir","Sunnatillo","Mirjalol","Akmal"];
  const F = ["Malika","Madina","Dilnoza","Sevara","Nilufar","Shahzoda","Gulnoza","Zarina","Kamola","Mohinur","Sarvinoz","Ozoda","Feruza","Mubina","Dildora","Robiya","Nigora","Durdona","Muxlisa","Yulduz","Shirin","Gavhar"];
  const SN = ["Karimov","Rahimov","Tursunov","Ergashov","Yoʻldoshev","Abdullayev","Nazarov","Qodirov","Saidov","Hamroyev","Usmonov","Joʻrayev","Toshpoʻlatov","Mirzayev","Sobirov","Xolmatov","Boboyev","Ismoilov","Raximov","Normatov"];
  const near = ["Jizzax shahri","Sharof Rashidov tumani"];
  const far = ["Zomin tumani","Gʻallaorol tumani","Forish tumani","Baxmal tumani","Doʻstlik tumani","Mirzachoʻl tumani","Paxtakor tumani","Zarbdor tumani","Yangiobod tumani","Zafarobod tumani","Arnasoy tumani"];
  const other = [["Samarqand viloyati","Bulungʻur tumani"],["Samarqand viloyati","Payariq tumani"],["Sirdaryo viloyati","Guliston shahri"],["Qashqadaryo viloyati","Chiroqchi tumani"],["Toshkent viloyati","Bekobod tumani"]];
  const streets = ["Sharq mahallasi","Navoiy koʻchasi","Oʻzbekiston koʻchasi","Mustaqillik koʻchasi","Bunyodkor mahallasi","Yoshlik koʻchasi","Gulzor mahallasi"];
  const branch = "Jizzax filiali";
  const facs = ["Amaliy matematika","Iqtisodiyot","Filologiya","Psixologiya"];
  const groups = []; const tutorsByFac = {};
  facs.forEach((fac, fi) => {
    tutorsByFac[fac] = [0,1,2].map(() => `${pick(SN)} ${pick(M)[0]}.`);
    let gi = 0;
    for (let course = 1; course <= 4; course++) for (let k = 1; k <= 3; k++){
      const name = `${course}${fi+1}${k}-${26-course}`;
      const gid = "g" + hash("demo|"+fac+"|"+name);
      const tutor = tutorsByFac[fac][Math.floor(gi/4)]; gi++;
      const size = 22 + Math.floor(rnd()*9);
      const studs = [];
      for (let i = 0; i < size; i++){
        const g = rnd() < (fac === "Filologiya" || fac === "Psixologiya" ? 0.68 : 0.42) ? "Q" : "O";
        const sn = pick(SN); const n = `${g === "Q" ? sn+"a" : sn} ${pick(g === "Q" ? F : M)}`;
        const r = rnd(); let vil = "Jizzax viloyati", tum;
        if (r < 0.38) tum = pick(near); else if (r < 0.82) tum = pick(far); else { const o = pick(other); vil = o[0]; tum = o[1]; }
        let rt; const x = rnd();
        if (near.includes(tum)) rt = x < 0.9 ? "Uy" : "Ijara";
        else if (vil === "Jizzax viloyati") rt = x < 0.35 ? "Uy" : x < 0.65 ? "Ijara" : x < 0.9 ? "TTJ" : "Qarindosh";
        else rt = x < 0.45 ? "TTJ" : x < 0.8 ? "Ijara" : "Qarindosh";
        if (rnd() < 0.035) rt = "";
        let ra = "";
        if (rt === "Uy") ra = `${tum}, ${pick(streets)}`;
        if (rt === "Ijara" || rt === "Qarindosh") ra = `Jizzax sh., ${pick(streets)} ${1+Math.floor(rnd()*60)}`;
        if (rt === "TTJ") ra = g === "O" ? "1-TTJ" : (rnd() < 0.55 ? "1-TTJ" : "2-TTJ");
        const days = Math.floor(rnd()*40);
        const up = rt ? new Date(Date.now() - days*864e5).toISOString() : "";
        studs.push({id:"s"+hash(gid+"|"+n+"|"+i), n, g, ph:`+99890${String(1000000+Math.floor(rnd()*8999999)).slice(0,7)}`, vil, tum, rt, ra, iz:"", up});
      }
      groups.push({id:gid, name, fac, course:String(course), branch, tutor, students:studs});
    }
  });
  const mkRooms = (did, spec) => { const rooms = []; for (const [fl, count, cap, g] of spec) for (let i = 1; i <= count; i++){ const no = `${fl}${pad(i)}`; rooms.push({id:"r"+hash(did+"|"+no), fl, no, cap, g}); } return rooms; };
  const d1 = {id:"d"+hash("demo|1-TTJ"), name:"1-TTJ", branch, tarb:"Qodirova Muhabbat", assign:{}};
  d1.rooms = mkRooms(d1.id, [[1,12,4,"O"],[2,12,4,"O"],[3,10,4,"Q"],[4,10,4,"Q"]]);
  const d2 = {id:"d"+hash("demo|2-TTJ"), name:"2-TTJ", branch, tarb:"Nazarova Barno", assign:{}};
  d2.rooms = mkRooms(d2.id, [[1,10,3,"Q"],[2,10,3,"Q"]]);
  const dorms = [d1, d2];
  for (const D of dorms){
    const cnt = {};
    const ttj = groups.flatMap(g => g.students).filter(s => s.rt === "TTJ" && s.ra === D.name);
    for (const s of ttj){ if (rnd() < 0.12) continue; const r = D.rooms.find(r => r.g === s.g && (cnt[r.id] || 0) < r.cap); if (!r) continue; D.assign[s.id] = r.id; cnt[r.id] = (cnt[r.id] || 0) + 1; }
  }
  const att = [];
  for (const D of dorms){
    const ids = Object.keys(D.assign);
    const chronic = ids.slice(5, 7);
    DAYS3.forEach(day => {
      const marks = {};
      for (const sid of ids){
        if (chronic.includes(sid)){ marks[sid] = "sababsiz"; continue; }
        if (day === TODAY && rnd() < 0.3) continue;
        const x = rnd();
        marks[sid] = x < 0.84 ? "bor" : x < 0.92 ? "uy" : x < 0.95 ? "ruxsat" : x < 0.975 ? "kasal" : "sababsiz";
      }
      att.push({id:`${D.id}_${day}`, dorm:D.id, date:day, marks});
    });
  }
  return {groups, dorms, att};
}

/* ----- own password ----- */
function passwordView(){
  return `<div class="actions"><button class="btn sm" data-act="pwclose">← Orqaga</button></div>
  <form class="panel" style="max-width:440px" data-form="pw"><h2>Parolni oʻzgartirish</h2>
    <div class="field"><label for="pw_old">Joriy parol</label><input type="password" id="pw_old" data-in="pw_old" value="${esc(S.pw.old)}" autocomplete="current-password"></div>
    <div class="field"><label for="pw_n1">Yangi parol</label><input type="password" id="pw_n1" data-in="pw_n1" value="${esc(S.pw.n1)}" autocomplete="new-password"><span class="sub">Kamida 8 belgi, harf va raqam boʻlsin.</span></div>
    <div class="field"><label for="pw_n2">Yangi parol (takror)</label><input type="password" id="pw_n2" data-in="pw_n2" value="${esc(S.pw.n2)}" autocomplete="new-password"></div>
    ${S.pwErr ? `<div class="alertbox">${esc(S.pwErr)}</div>` : ""}
    <div class="actions"><button class="btn primary" type="submit">Saqlash</button></div>
    <p class="sub">Parol oʻzgargach, boshqa qurilmalardagi kirishlar yopiladi.</p></form>`;
}
async function savePassword(){
  if (S.pw.n1 !== S.pw.n2){ S.pwErr = "Yangi parollar bir xil emas."; return render(); }
  try { await api("/api/password", {old:S.pw.old, new:S.pw.n1}); S.pw = {old:"", n1:"", n2:""}; S.pwErr = ""; S.pwOpen = false; toast("Parol oʻzgartirildi."); render(); }
  catch (e){ S.pwErr = e.error; render(); }
}

/* ----- audit log ----- */
const AUDIT_L = {"login":"Tizimga kirdi","login-fail":"Notoʻgʻri parol bilan kirishga urinish","register":"Kirish soʻrovi yubordi","setup":"Bosh administrator yaratildi",
  "student":"Talaba turar joyini oʻzgartirdi","assign":"Xonaga joylashtirish","allbor":"Hammasini “Bor” qildi","replace":"Maʼlumotlar yuklandi","clear":"Baza tozalandi",
  "staff":"Huquqlarni oʻzgartirdi","create":"Hisob ochdi","revoke":"Hisobni oʻchirdi","password":"Parolini oʻzgartirdi","settings":"Sozlamalarni oʻzgartirdi",
  "fac-add":"Fakultet qoʻshdi","fac-rename":"Fakultet nomini oʻzgartirdi","fac-delete":"Fakultetni oʻchirdi","group-add":"Guruh qoʻshdi","group-delete":"Guruhni oʻchirdi",
  "group-tutor":"Tyutor biriktirdi","student-add":"Talaba qoʻshdi","dorm-new":"Yotoqxona qoʻshdi","dorm-submit":"Xonalarni tasdiqqa yubordi","dorm-approve":"Xonalarni tasdiqladi","dorm-reject":"Xonalarni rad etdi"};
function niceDetail(t){
  const ids = byId();
  return String(t || "").replace(/\b([gds][0-9a-z]{5,12})\b/g, id => S.groups.get(id)?.name ? "guruh " + S.groups.get(id).name : S.dorms.get(id)?.name || ids.get(id)?.n || id)
    .replace(/[{}"]/g, "").replace(/\brt:/g, "turi: ").replace(/\bra:/g, "manzil: ").replace(/\//g, " · ");
}
function auditView(){
  if (!S.audit){ api("/api/audit").then(r => { S.audit = r.items; render(); }).catch(e => toast(e.error)); return `<div class="empty">Yuklanmoqda…</div>`; }
  const fmt = iso => { const d = new Date(iso); return isNaN(d) ? iso : `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  return `<div class="panel"><div class="panel-head"><h2>Harakatlar jurnali</h2><div class="actions"><span class="sub">Oxirgi ${S.audit.length} ta yozuv</span><button class="btn sm" data-act="auditreload">Yangilash</button></div></div>
  <div class="tbl"><table><thead><tr><th>Vaqt</th><th>Kim</th><th>Harakat</th><th>Tafsilot</th></tr></thead><tbody>
  ${S.audit.map(a => `<tr class="${a.action === "login-fail" ? "warnrow" : ""}"><td class="num muted">${esc(fmt(a.at))}</td><td>${esc(a.who || "—")}</td><td>${esc(AUDIT_L[a.action] || a.action)}</td><td class="muted" style="white-space:normal;max-width:420px">${esc(niceDetail(a.detail))}</td></tr>`).join("")}
  </tbody></table></div></div>`;
}

/* ----- import: one call replaces students and dorms ----- */
async function runReplace(groups, dorms, att, source){
  S.busy = "Serverga yozilmoqda…"; render();
  const ok = await act("/api/replace", {groups, dorms, att, source}, source === "demo" ? "Namuna maʼlumot yuklandi." : "Maʼlumot bazaga yozildi.");
  S.busy = ""; if (ok){ S.imp = null; S.confirm = ""; S.f = {branch:"", fac:"", course:"", g:"", rt:""}; S.draft = null; }
  render();
}

/* ---------------- events ---------------- */
const val = id => (document.getElementById(id)?.value || "").trim();
async function doAuth(kind){
  const f = S.form;
  S.formErr = "";
  try {
    await api(kind === "login" ? "/api/login" : "/api/register", kind === "login" ? {username:f.username, password:f.password} : {name:f.name, username:f.username, password:f.password});
    S.form = {name:"", username:"", password:"", token:""};
    render();
  } catch (e){ S.formErr = e.error; render(); }
}
function updDraft(fn){ fn(S.draft); S.draftDirty = true; render(); }

$app.addEventListener("submit", e => { e.preventDefault(); if (e.target.dataset.form === "auth") doAuth(S.gate === "login" ? "login" : "register"); if (e.target.dataset.form === "pw") savePassword(); });
$app.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
  const a = b.dataset.act;
  const D = S.curDorm;
  switch (a){
    case "login": doAuth("login"); return;
    case "register": doAuth("register"); return;
    case "gate": S.gate = b.dataset.to; S.formErr = ""; break;
    case "rerequest": api("/api/rerequest", {name:S.form.name}).then(() => { S.formErr = ""; render(); }).catch(e => { S.formErr = e.error; render(); }); return;
    case "pwopen": S.pwOpen = true; S.pwErr = ""; window.scrollTo(0,0); break;
    case "pwclose": S.pwOpen = false; break;
    case "auditreload": S.audit = null; break;
    case "logout": api("/api/logout", {}).catch(() => {}).then(async () => { S.loaded = false; S.perms = null; S.gate = "login"; S.edit = null; S.draft = null; S.pwOpen = false; S.audit = null; await loadMe(); render(); }); return;
    case "cancelreq": api("/api/cancelreq", {}).catch(() => {}).then(() => { S.gate = "login"; render(); }); return;
    case "tab": if (b.dataset.tab === "jurnal") S.audit = null; S.tab = b.dataset.tab; store.set("tm_tab", S.tab); S.limit = 100; S.confirm = ""; window.scrollTo(0,0); break;
    case "dtab": S.dormTab = b.dataset.tab; break;
    case "clearf": S.f = {branch:"",fac:"",course:"",g:"",rt:""}; break;
    case "more": S.limit += 200; break;
    case "opengroup": S.openGroup = b.dataset.gid; window.scrollTo(0,0); break;
    case "closegroup": S.openGroup = null; break;
    case "openroom": S.openRoom = S.openRoom === b.dataset.room ? null : b.dataset.room; S.pickAssign = ""; break;
    case "closeroom": S.openRoom = null; break;
    case "assign": { const sid = val("assignpick"); if (!sid){ toast("Avval talabani tanlang."); return; } act("/api/assign", {did:D, sid, rid:b.dataset.room}, "Talaba xonaga joylashtirildi."); S.pickAssign = ""; return; }
    case "qassign": { const sid = b.dataset.sid; const rid = val("qr_"+sid); if (!rid) return; act("/api/assign", {did:D, sid, rid}, "Joylashtirildi."); return; }
    case "unassign": act("/api/assign", {did:D, sid:b.dataset.sid, rid:null}, "Talaba xonadan chiqarildi."); return;
    case "mark": { const sid = b.dataset.sid, st = b.dataset.st; const cur = (S.att.get(`${D}_${TODAY}`)?.marks || {})[sid]; act("/api/att", {did:D, sid, st: cur === st ? null : st}); return; }
    case "allbor": act("/api/allbor", {did:D}, "Belgilanmaganlar “Bor” qilindi."); return;
    /* dorm structure draft */
    case "addroom": { const fl = +b.dataset.fl; const no = val("nr_no_"+fl) || document.getElementById("nr_no_"+fl)?.placeholder; const cap = +val("nr_cap_"+fl) || 4; const g = val("nr_g_"+fl);
      if (S.draft.some(r => r.no === no)){ toast(`Xona ${no} allaqachon bor.`); return; }
      updDraft(r => r.push({id:"r"+Math.random().toString(36).slice(2,10), fl, no, cap, g})); return; }
    case "addfloor": { const fl = +val("nf_fl"), cnt = Math.min(60, Math.max(1, +val("nf_cnt") || 1)), cap = +val("nf_cap") || 4, g = val("nf_g");
      if (!(fl >= 0)) { toast("Qavat raqamini kiriting."); return; }
      updDraft(r => { let k = 1, made = 0; while (made < cnt && k < 200){ const no = `${fl}${pad(k)}`; k++; if (r.some(x => x.no === no)) continue; r.push({id:"r"+Math.random().toString(36).slice(2,10), fl, no, cap, g}); made++; } });
      toast(`${fl}-qavat qoʻshildi. Saqlashni unutmang.`); return; }
    case "rmroom": updDraft(r => { const i = r.findIndex(x => x.id === b.dataset.rid); if (i >= 0) r.splice(i, 1); }); return;
    case "savedraft": act("/api/dorm/draft", {did:D, rooms:S.draft}, "Qoralama saqlandi.").then(ok => { if (ok) S.draftDirty = false; render(); }); return;
    case "submitdraft": act("/api/dorm/submit", {did:D, rooms:S.draft}, "Direktor tasdigʻiga yuborildi.").then(ok => { if (ok){ S.draft = null; S.draftDirty = false; render(); } }); return;
    case "withdraw": act("/api/dorm/draft", {did:D, withdraw:true}, "Soʻrov qaytarib olindi.").then(() => { S.draft = null; render(); }); return;
    case "discarddraft": act("/api/dorm/draft", {did:D, discard:true}, "Qoralama bekor qilindi.").then(() => { S.draft = null; render(); }); return;
    case "approve": act("/api/dorm/decide", {did:b.dataset.did, decision:"approve"}, "Tasdiqlandi va joriy etildi."); return;
    case "rejectdraft": { const did = b.dataset.did; const note = S.decideNote[did] || ""; if (!note.trim()){ toast("Rad etish sababini yozing."); document.getElementById("note_"+did)?.focus(); return; } act("/api/dorm/decide", {did, decision:"reject", note}, "Rad etildi."); return; }
    /* structure */
    case "addfac": act("/api/fac", {action:"add", name:val("nfac")}, "Fakultet qoʻshildi."); return;
    case "renamefac": S.renameFac = b.dataset.fac; break;
    case "cancelrename": S.renameFac = null; break;
    case "dorename": act("/api/fac", {action:"rename", name:b.dataset.fac, newName:val("rn_fac")}, "Nomi oʻzgartirildi.").then(ok => { if (ok){ S.renameFac = null; render(); } }); return;
    case "delfac": act("/api/fac", {action:"delete", name:b.dataset.fac}, "Fakultet oʻchirildi."); return;
    case "addgroup": act("/api/group", {action:"add", fac:val("ng_fac"), course:val("ng_course"), name:val("ng_name"), tutorUid:val("ng_tutor")}, "Guruh qoʻshildi."); return;
    case "delgroup": act("/api/group", {action:"delete", gid:b.dataset.gid}, "Guruh oʻchirildi."); return;
    case "addstu": S.addStu = b.dataset.gid; break;
    case "cancelstu": S.addStu = null; break;
    case "savestu": act("/api/group", {action:"student", gid:b.dataset.gid, n:val("ns_n"), g:val("ns_g"), vil:val("ns_vil"), tum:val("ns_tum"), ph:val("ns_ph")}, "Talaba qoʻshildi.").then(ok => { if (ok){ ["ns_n","ns_vil","ns_tum","ns_ph"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; }); document.getElementById("ns_n")?.focus(); } }); return;
    case "adddorm": act("/api/dorm/new", {name:val("ndorm")}, "Yotoqxona qoʻshildi."); return;
    /* import */
    case "demo": { if (hasData() && S.confirm !== "demo"){ S.confirm = "demo"; break; } S.confirm = ""; const d = makeDemo(); runReplace(d.groups, d.dorms, d.att, "demo"); return; }
    case "askimport": S.confirm = "import"; break;
    case "doimport": runReplace(S.imp.groups, S.imp.dorms, [], "excel"); return;
    case "dropimp": S.imp = null; S.confirm = ""; break;
    case "askclear": S.confirm = "clear"; break;
    case "doclear": S.confirm = ""; act("/api/clear", {}, "Baza tozalandi."); return;
    case "cancel": S.confirm = ""; break;
    /* users */
    case "newuser": openEdit(null, true); window.scrollTo(0,0); break;
    case "grant": openEdit(b.dataset.uid, true); window.scrollTo(0,0); break;
    case "editu": openEdit(b.dataset.uid, false); window.scrollTo(0,0); break;
    case "closeedit": S.edit = null; break;
    case "saveu": saveEdit(); return;
    case "askreject": S.confirm = "rej:"+b.dataset.uid; break;
    case "askrevoke": S.confirm = "rm:"+b.dataset.uid; break;
    case "dorevoke": { const uid = b.dataset.uid; S.confirm = ""; act("/api/revoke", {uid}, "Hisob oʻchirildi."); return; }
  }
  render();
});
$app.addEventListener("change", e => {
  const el = e.target;
  if (el.dataset.eflag && S.edit){ S.edit[el.dataset.eflag] = el.checked; S.editErr = ""; render(); return; }
  if (el.dataset.esc && S.edit){ const arr = S.edit[el.dataset.esc]; const v = el.value; const i = arr.indexOf(v); if (el.checked && i < 0) arr.push(v); if (!el.checked && i >= 0) arr.splice(i, 1); render(); return; }
  if (el.dataset.roomCap){ const v = Math.max(1, Math.min(20, +el.value || 1)); updDraft(r => { const x = r.find(q => q.id === el.dataset.roomCap); if (x) x.cap = v; }); return; }
  if (el.dataset.roomG !== undefined && el.dataset.roomG){ updDraft(r => { const x = r.find(q => q.id === el.dataset.roomG); if (x) x.g = el.value; }); return; }
  if (el.dataset.setting){ act("/api/settings", {[el.dataset.setting]: el.checked}, el.checked ? "Xodimlar soʻrov yubora oladi." : "Endi hisoblarni faqat administrator ochadi."); return; }
  if (el.dataset.gtutor){ act("/api/group", {action:"tutor", gid:el.dataset.gtutor, tutorUid:el.value}, "Tyutor biriktirildi."); return; }
  const k = el.dataset.ch; if (!k) return;
  if (k === "e_tut" && S.edit){ for (const g of S.groups.values()) if (g.tutor === el.value && !S.edit.groups.includes(g.id)) S.edit.groups.push(g.id); render(); return; }
  if (k === "structfac"){ S.structFac = el.value; render(); return; }
  if (k === "curdorm"){ S.curDorm = el.value; store.set("tm_dorm", S.curDorm); S.openRoom = null; S.draft = null; render(); return; }
  if (k.startsWith("f_")){ S.f[k.slice(2)] = el.value; S.limit = 100; render(); return; }
  if (k === "assignpick"){ S.pickAssign = el.value; return; }
  if (k === "rt"){ act("/api/student", {gid:el.dataset.gid, sid:el.dataset.sid, patch:{rt:el.value}}, "Saqlandi."); return; }
  if (k === "ra"){ act("/api/student", {gid:el.dataset.gid, sid:el.dataset.sid, patch:{ra:el.value.trim()}}, "Saqlandi."); return; }
  if (k === "xfile"){
    const file = el.files && el.files[0]; if (!file) return;
    S.busy = "Fayl oʻqilmoqda…"; render();
    file.arrayBuffer().then(buf => XLSXLite.read(buf))
      .then(book => { S.imp = parseWorkbook(book, file.name); S.busy = ""; S.confirm = ""; render(); })
      .catch(err => { S.busy = ""; S.imp = null; toast("Faylni oʻqib boʻlmadi: " + (err.error || err.message || "nomaʼlum xato")); render(); });
  }
});
let qT = 0;
$app.addEventListener("input", e => {
  const el = e.target, k = el.dataset.in;
  if (k === "q"){ S.q = el.value; S.limit = 100; clearTimeout(qT); qT = setTimeout(render, 180); }
  if (k === "a_name") S.form.name = el.value;
  if (k === "a_user") S.form.username = el.value;
  if (k === "a_pass") S.form.password = el.value;
  if (k === "a_token") S.form.token = el.value;
  if (k === "pw_old") S.pw.old = el.value;
  if (k === "pw_n1") S.pw.n1 = el.value;
  if (k === "pw_n2") S.pw.n2 = el.value;
  if (k === "e_name" && S.edit) S.edit.name = el.value;
  if (k === "e_user" && S.edit) S.edit.username = el.value;
  if (k === "e_pass" && S.edit) S.edit.password = el.value;
  if (el.dataset.note) S.decideNote[el.dataset.note] = el.value;
});
$app.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.id === "nfac"){ e.preventDefault(); act("/api/fac", {action:"add", name:val("nfac")}, "Fakultet qoʻshildi."); }
});

/* ---------------- boot: one login, then live updates ---------------- */
render();
initFirebase();
if (!navigator.userAgent.includes("TalabaMakonApp")) fetch("TalabaMakon.apk", {method:"HEAD"}).then(r => { if ((r.headers.get("content-type") || "").includes("android")){ S.apkReady = true; renderSoon(); } }).catch(() => {});
window.addEventListener("online", () => { S.offline = false; renderSoon(); });
window.addEventListener("offline", () => { S.offline = true; renderSoon(); });
})();
