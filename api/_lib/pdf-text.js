// ════════════════════════════════════════════════════════════════
//  api/_lib/pdf-text.js  —  Texte sûr pour les polices PDF standard
//
//  pdf-lib encode les polices standard (Helvetica…) en WinAnsi, qui ne
//  couvre PAS les emoji ni la plupart des symboles : un simple « 🖥️ »
//  venu d'un select Notion, ou un emoji tapé par un candidat dans un
//  champ libre, fait échouer la génération entière du document.
//  On retire donc tout caractère non encodable AVANT de dessiner.
// ════════════════════════════════════════════════════════════════

// Caractères hors Latin-1 que WinAnsi sait tout de même représenter
// (guillemets typographiques, tirets longs, €, …).
const SPECIAUX = new Set([
  0x20AC, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017D, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022,
  0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x017E, 0x0178,
]);

export function winAnsi(texte) {
  let out = '';
  for (const ch of String(texte ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0A || cp === 0x0D || cp === 0x09) { out += ' '; continue; }
    if (cp >= 0x20 && cp <= 0xFF) { out += ch; continue; }
    if (SPECIAUX.has(cp)) { out += ch; continue; }
    // Emoji, sélecteurs de variante, liants : ignorés silencieusement.
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
