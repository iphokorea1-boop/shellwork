/* Shellwork — Word (.docx) export without a library: the shell tree becomes Title / Heading 1–6 / body
 * paragraphs (with bullets, numbers, bold and italic), packed into a plain uncompressed ZIP. */
(function (SW) {
  'use strict';
  const S = SW.store;
  const enc = new TextEncoder();
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ---------- zip (store method) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const out = [], central = []; let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
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
    return new Blob(out.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- word xml ---------- */
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  function runs(text) {
    return String(text).split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/).filter(Boolean).map((part) => {
      let rpr = '', t = part;
      if (/^\*\*[^*]+\*\*$/.test(part)) { rpr = '<w:rPr><w:b/></w:rPr>'; t = part.slice(2, -2); }
      else if (/^\*[^*\s][^*]*\*$/.test(part)) { rpr = '<w:rPr><w:i/></w:rPr>'; t = part.slice(1, -1); }
      return '<w:r>' + rpr + '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
    }).join('');
  }
  const para = (style, inner, ind) => '<w:p><w:pPr>' + (style ? '<w:pStyle w:val="' + style + '"/>' : '') + (ind || '') + '</w:pPr>' + inner + '</w:p>';
  function bodyParas(text) {
    const out = [];
    String(text || '').split('\n').forEach((line) => {
      const ul = /^(\s*)[-*•]\s+(.*)$/.exec(line), ol = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line), h = /^#{1,6}\s+(.*)$/.exec(line);
      if (ul || ol) {
        const lvl = Math.min(3, Math.floor((ul || ol)[1].replace(/\t/g, '  ').length / 2));
        const left = 360 + lvl * 360;
        out.push(para('ListParagraph', runs((ul ? '•' : ol[2] + '.') + ' ') + runs(ul ? ul[2] : ol[3]), '<w:ind w:left="' + left + '" w:hanging="280"/>'));
      } else if (h) out.push(para(null, '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">' + esc(h[1]) + '</w:t></w:r>'));
      else if (line.trim()) out.push(para(null, runs(line)));
    });
    return out.join('');
  }
  function documentXml() {
    const ps = [para('Title', runs(S.board.name))];
    S.walk((s) => {
      if (!S.isText(s)) ps.push(para('Heading' + Math.min(6, S.level(s.id)), runs(s.title.trim() || '(제목 없음)')));
      ps.push(bodyParas(s.body));
      if (s.src && (s.src.name || s.src.page)) {
        const bits = [s.src.kind === 'photo' ? '사진' : '자료', s.src.name, s.src.page ? 'p.' + s.src.page : '', s.src.date ? new Date(s.src.date).toLocaleDateString('ko-KR') : ''].filter(Boolean);
        ps.push(para('Source', runs('출처: ' + bits.join(', '))));
      }
    });
    const rel = S.board.arrows.filter((a) => S.get(a.from) && S.get(a.to));
    if (rel.length) {
      ps.push(para('Heading1', runs('관계')));
      rel.forEach((a) => ps.push(para('ListParagraph', runs('• ' + S.label(S.get(a.from)) + ' → ' + S.label(S.get(a.to))), '<w:ind w:left="360" w:hanging="280"/>')));
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + W + '><w:body>' + ps.join('') +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  }
  function stylesXml() {
    const font = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="맑은 고딕" w:cs="Calibri"/>';
    const h = (n, size, before) => '<w:style w:type="paragraph" w:styleId="Heading' + n + '"><w:name w:val="heading ' + n + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="' + before + '" w:after="100"/><w:outlineLvl w:val="' + (n - 1) + '"/></w:pPr><w:rPr><w:b/><w:sz w:val="' + size + '"/></w:rPr></w:style>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ' + W + '>' +
      '<w:docDefaults><w:rPrDefault><w:rPr>' + font + '<w:sz w:val="21"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>' +
      h(1, 32, 360) + h(2, 28, 280) + h(3, 25, 240) + h(4, 23, 200) + h(5, 22, 160) + h(6, 21, 160) +
      '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="6B6B73"/><w:sz w:val="18"/></w:rPr></w:style>' +
      '</w:styles>';
  }

  SW.docx = {
    build: () => zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>' },
      { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
      { name: 'word/_rels/document.xml.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'word/document.xml', text: documentXml() },
      { name: 'word/styles.xml', text: stylesXml() },
    ]),
  };
})(window.SW);
