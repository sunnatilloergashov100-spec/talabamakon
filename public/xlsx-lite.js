/* .xlsx faylini brauzerning oʻzida oʻqiydi (tashqi kutubxonasiz).
   XLSXLite.read(arrayBuffer) → {names:[varaq nomlari], sheets:{nom: [[katak, ...], ...]}} */
(function (root) {
  "use strict";
  const dec = new TextDecoder("utf-8");

  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Bu .xlsx fayl emas. Faylni Excel'da “.xlsx” shaklida saqlang.");
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {};
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = {method, csize, lho};
      p += 46 + nlen + xlen + clen;
    }
    return {
      has: name => name in files,
      async text(name) {
        const f = files[name]; if (!f) return null;
        const lnl = dv.getUint16(f.lho + 26, true), lxl = dv.getUint16(f.lho + 28, true);
        const start = f.lho + 30 + lnl + lxl;
        const data = u8.subarray(start, start + f.csize);
        if (f.method === 0) return dec.decode(data);
        if (f.method === 8) return dec.decode(await inflate(data));
        throw new Error("Fayl siqish usuli qoʻllab-quvvatlanmaydi.");
      }
    };
  }

  const ent = s => s.replace(/&(lt|gt|quot|apos|amp|#x[0-9a-fA-F]+|#\d+);/g, (m, e) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "quot" ? '"' : e === "apos" ? "'" : e === "amp" ? "&" :
    e[1] === "x" ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)));
  const attr = (tag, a) => { const m = tag.match(new RegExp("\\b" + a + "\\s*=\\s*\"([^\"]*)\"")); return m ? ent(m[1]) : null; };
  const texts = xml => { let out = ""; xml.replace(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g, (m, t) => { out += ent(t); return m; }); return out; };
  const colIndex = ref => { let c = 0; for (const ch of (ref.match(/^[A-Z]+/) || [""])[0]) c = c * 26 + (ch.charCodeAt(0) - 64); return c - 1; };

  async function read(buf) {
    const z = await unzip(buf);
    const shared = [];
    const ss = await z.text("xl/sharedStrings.xml");
    if (ss) ss.replace(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g, (m, si) => { shared.push(texts(si)); return m; });
    const rels = {};
    const relXml = await z.text("xl/_rels/workbook.xml.rels") || "";
    relXml.replace(/<Relationship\b[^>]*>/g, tag => { rels[attr(tag, "Id")] = attr(tag, "Target"); return tag; });
    const wb = await z.text("xl/workbook.xml");
    if (!wb) throw new Error("Faylni oʻqib boʻlmadi. U .xlsx shaklida ekanini tekshiring.");
    const names = [], sheets = {};
    const sheetTags = wb.match(/<(?:\w+:)?sheet\b[^>]*\/?>/g) || [];
    for (const tag of sheetTags) {
      const name = attr(tag, "name"), rid = attr(tag, "r:id");
      let target = rels[rid] || "";
      const path = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
      const xml = await z.text(path);
      if (xml == null) continue;
      const rows = [];
      xml.replace(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g, (m, rowXml) => {
        const cells = [];
        rowXml.replace(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g, (cm, attrs, inner) => {
          const tag = "<c " + attrs + ">";
          const ref = attr(tag, "r") || "", t = attr(tag, "t");
          const col = ref ? colIndex(ref) : cells.length;
          let v = "";
          const vm = (inner || "").match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
          if (t === "s" && vm) v = shared[parseInt(vm[1], 10)] ?? "";
          else if (t === "inlineStr") v = texts(inner || "");
          else if (t === "b" && vm) v = vm[1] === "1" ? "TRUE" : "FALSE";
          else if (vm) {
            v = ent(vm[1]);
            if (t !== "str" && t !== "e" && v !== "" && !isNaN(Number(v))) { const f = Number(v); v = Number.isInteger(f) ? String(f) : String(f); }
          }
          cells[col] = v;
          return cm;
        });
        if (cells.length) rows.push(Array.from(cells, x => x ?? ""));
        return m;
      });
      names.push(name);
      sheets[name] = rows;
    }
    return {names, sheets};
  }

  root.XLSXLite = {read};
})(typeof window !== "undefined" ? window : globalThis);
