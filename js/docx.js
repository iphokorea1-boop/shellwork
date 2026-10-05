/* Shellwork — Word (.docx) export without a library: the shell tree (or a written Markdown document) becomes
 * Title / Heading 1–6 / body paragraphs with bullets, numbers, bold, italic, tables and pictures, packed into a plain ZIP. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const enc = new TextEncoder();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const NL = String.fromCharCode(10);

  /* ---------- zip (store method) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files, type) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const out = [], central = []; let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = f.bytes || enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      out.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const size = central.reduce((s, a) => s + a.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob(out.concat(central, [new Uint8Array(end.buffer)]), { type: type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  SW.zip = zip;
  const bytesOf = (dataUrl) => {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || ''); if (!m) return null;
    const bin = atob(m[2]), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { type: m[1], u8 };
  };

  /* ---------- word xml ---------- */
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const W_ONLY = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const TEXT_W = 9298; // A4 width minus margins, in twentieths of a point
  function runs(text, bold) {
    return String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/).filter(Boolean).map((part) => {
      let b = !!bold, i = false, t = part;
      if (/^\*\*[^*]+\*\*$/.test(part)) { b = true; t = part.slice(2, -2); }
      else if (/^\*[^*\s][^*]*\*$/.test(part)) { i = true; t = part.slice(1, -1); }
      const rpr = b || i ? '<w:rPr>' + (b ? '<w:b/>' : '') + (i ? '<w:i/>' : '') + '</w:rPr>' : '';
      return '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(t.replace(/`/g, '')) + '</w:t></w:r>';
    }).join('');
  }
  const para = (style, inner, ind) => '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (ind || '') + '</w:pPr>' + inner + '</w:p>';

  function tableXml(rows) {
    const n = Math.max(...rows.map((r) => r.length)), cw = Math.floor(TEXT_W / n);
    const border = (side) => '<w:' + side + ' w:val="single" w:sz="4" w:space="0" w:color="C9C9CF"/>';
    let x = '<w:tbl><w:tblPr><w:tblW w:w="' + TEXT_W + '" w:type="dxa"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') +
      '</w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>';
    for (let i = 0; i < n; i++) x += '<w:gridCol w:w="' + cw + '"/>';
    x += '</w:tblGrid>';
    rows.forEach((r, ri) => {
      x += '<w:tr>' + (ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : '');
      for (let i = 0; i < n; i++) {
        x += '<w:tc><w:tcPr><w:tcW w:w="' + cw + '" w:type="dxa"/>' + (ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F4F8"/>' : '') + '</w:tcPr>' +
          '<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>' + runs(r[i] || '', ri === 0) + '</w:p></w:tc>';
      }
      x += '</w:tr>';
    });
    return x + '</w:tbl>' + para(null, ''); // Word needs a paragraph after a table
  }

  /* a picture as an inline drawing, at most 15 cm wide and 18 cm tall */
  function pictureXml(ctx, imgId, ratio) {
    const data = bytesOf(SW.images && SW.images.url(imgId)); if (!data) return '';
    const ext = data.type === 'image/png' ? 'png' : 'jpeg', n = ctx.media.length + 1, rid = 'rIdImg' + n;
    ctx.media.push({ name: 'word/media/image' + n + '.' + ext, bytes: data.u8, rid, ext });
    const r = ratio || 0.75; let w = 15, h = w * r; if (h > 18) { h = 18; w = h / r; }
    const cx = Math.round(w * 360000), cy = Math.round(h * 360000);
    return '<w:p><w:pPr><w:spacing w:before="120" w:after="60"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + n + '" name="그림 ' + n + '"/>' +
      '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="' + n + '" name="image' + n + '.' + ext + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  const ratioOf = (imgId) => { const n = Object.values(S.board.shells).find((s) => s.img === imgId); return n ? n.ratio : 0.75; };

  /* Markdown lines → paragraphs; ctx.headings turns # lines into real headings (written documents) */
  function bodyParas(text, ctx) {
    const out = [], lines = String(text || '').split(NL);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SW.isTableStart(lines, i)) { const j = SW.tableEnd(lines, i); out.push(tableXml(SW.mdTable(lines.slice(i, j)))); i = j - 1; continue; }
      const fig = SW.FIGURE.exec(line);
      if (fig) {
        const node = Object.values(S.board.shells).find((s) => s.img === fig[1]);
        out.push(pictureXml(ctx, fig[1], ratioOf(fig[1])));
        if (node && node.body.trim()) out.push(para('Caption', runs(node.body.trim().split(NL)[0])));
        continue;
      }
      const ul = /^(\s*)[-*•]\s+(.*)$/.exec(line), ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line), h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (ul || ol) {
        const lvl = Math.min(3, Math.floor((ul || ol)[1].replace(/\t/g, '  ').length / 2));
        const left = 360 + lvl * 360;
        out.push(para('ListParagraph', runs((ul ? '•' : ol[2] + '.') + ' ') + runs(ul ? ul[2] : ol[3]), '<w:ind w:left="' + left + '" w:hanging="280"/>'));
      } else if (h && ctx.headings) out.push(para('Heading' + Math.min(6, Math.max(1, h[1].length - 1)), runs(h[2])));
      else if (h) out.push(para(null, runs(h[2], true)));
      else if (line.trim()) out.push(para(null, runs(line)));
    }
    return out.join('');
  }

  function boardXml(ctx) {
    const ps = [para('Title', runs(S.board.name))];
    S.walk((s) => {
      if (S.isImage(s)) {
        ps.push(pictureXml(ctx, s.img, s.ratio));
        if (s.body.trim()) ps.push(para('Caption', runs(s.body.trim().replace(/\s*\n\s*/g, ' '))));
        return;
      }
      if (!S.isText(s)) ps.push(para('Heading' + Math.min(6, S.level(s.id)), runs(s.title.trim() || '(제목 없음)')));
      ps.push(bodyParas(s.body, ctx));
      if (s.src && (s.src.name || s.src.page)) {
        const bits = [s.src.kind === 'photo' ? '사진' : '자료', s.src.name, s.src.page ? 'p.' + s.src.page : '', s.src.date ? new Date(s.src.date).toLocaleDateString('ko-KR') : ''].filter(Boolean);
        ps.push(para('Source', runs('출처: ' + bits.join(', '))));
      }
    });
    const rel = S.relations();
    if (rel.length) {
      ps.push(para('Heading1', runs('관계')));
      rel.forEach((r) => ps.push(para('ListParagraph', runs('• ' + r.text), '<w:ind w:left="360" w:hanging="280"/>')));
    }
    return ps.join('');
  }
  function markdownXml(md, title, ctx) {
    const lines = String(md || '').replace(/\r/g, '').split(NL);
    let name = title || S.board.name;
    const first = lines.findIndex((l) => l.trim());
    if (first >= 0 && /^#\s+/.test(lines[first])) { name = lines[first].replace(/^#\s+/, '').trim(); lines.splice(first, 1); }
    return para('Title', runs(name)) + bodyParas(lines.join(NL), ctx);
  }

  function documentXml(inner) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + '><w:body>' + inner +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  function stylesXml() {
    const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="맑은 고딕" w:cs="Calibri"/>';
    const h = (n, size, before) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="' + before + '" w:after="100"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + size + '"/></w:rPr></w:style>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W_ONLY + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + font + '<w:sz w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
      h(1, 32, 360) + h(2, 28, 280) + h(3, 25, 240) + h(4, 23, 200) + h(5, 22, 160) + h(6, 21, 160) +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr><w:rPr><w:color w:val="6B6B73"/><w:sz w:val="18"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="6B6B73"/><w:sz w:val="18"/></w:rPr></w:style>' +
      '</w:styles>';
  }
  function pack(inner, ctx) {
    const rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>' +
      ctx.media.map((m) => '<Relationship Id="' + m.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="' + m.name.replace('word/', '') + '"/>').join('');
    return zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>' },
      { name: 'word/document.xml', text: documentXml(inner) },
      { name: 'word/styles.xml', text: stylesXml() },
      // a current-format document (without this Word opens it in compatibility mode)
      { name: 'word/settings.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ' + W_ONLY + '><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>' },
    ].concat(ctx.media.map((m) => ({ name: m.name, bytes: m.bytes }))));
  }

  SW.docx = {
    /* the board as it is: the shell tree with its pictures */
    build: () => { const ctx = { media: [] }; return pack(boardXml(ctx), ctx); },
    /* a written Markdown document (AI writing); [[그림:id]] lines become the board's pictures */
    fromMarkdown: (md, title) => { const ctx = { media: [], headings: true }; return pack(markdownXml(md, title, ctx), ctx); },
  };
})(window.SW);
