// ════════════════════════════════════════════════════════════════
//  api/_lib/dossier-contact.js  —  Écriture du dossier d'inscription
//  RS6776 dans le CRM Notion (base **CONTACTS**)
//
//  Le dossier d'inscription tient le CRM à jour : coordonnées confirmées
//  par le candidat, poste, statut pipeline, et le détail complet dans le
//  corps de la fiche (rien n'est écrasé). La base « Candidats » RS6776
//  sert aux évaluations écrites/orales (usage interne du jury) et n'est
//  volontairement pas alimentée ici.
// ════════════════════════════════════════════════════════════════

import { DB, notion, queryAll } from './notion-crm.js';
import { CERT_RS6776 } from './dossier-rs6776.js';

const txt = (c) => [{ type: 'text', text: { content: (c || '').slice(0, 2000) } }];
const linkTxt = (label, url) => [{ type: 'text', text: { content: label.slice(0, 2000), link: url ? { url } : null } }];
const para = (c) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: txt(c) } });
const h2 = (c) => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: txt(c) } });
const bullet = (c) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: txt(c) } });
const linkPara = (label, url) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: linkTxt(label, url) } });

function dossierBlocks(clean, { pdfUrl, horodatage, ip }) {
  const poste = clean.posteNonConcerne
    ? ['Si en poste : Non concerné(e)']
    : [
        `Poste : ${clean.intitulePoste} — ${clean.nomEntreprise}`,
        `Temps de travail : ${clean.tempsTravail === 'Autre' ? clean.tempsTravailAutre + '%' : clean.tempsTravail} · Contrat : ${clean.typeContrat} · Cadre : ${clean.statutCadre}`,
      ];
  return [
    h2(`Dossier d'inscription ${CERT_RS6776.code} — soumis le ${horodatage}`),
    linkPara('📄 PDF définitif (à transmettre à InKréa)', pdfUrl),
    bullet(`Identité : ${[clean.prenom, clean.prenom2, clean.prenom3].filter(Boolean).join(', ')} ${clean.nomNaissance}${clean.nomUsage ? ` (usage : ${clean.nomUsage})` : ''}`),
    bullet(`Contact : ${clean.email} · ${clean.telephone}`),
    bullet(`Naissance : ${clean.dateNaissance} — ${clean.cpVilleNaissance}, ${clean.paysNaissance}`),
    bullet(`Situation : ${clean.situationPro}`),
    bullet(`Qualification : ${clean.niveauQualif} — depuis le ${clean.niveauDepuis}`),
    bullet(`Dernière certification : ${clean.derniereCertif}`),
    ...poste.map(bullet),
    bullet(`Objectif : ${clean.objectif}${clean.objectifAutre ? ` — ${clean.objectifAutre}` : ''}`),
    para(`Consentement recueilli électroniquement le ${horodatage} (heure de Paris)${ip ? ` — IP ${ip}` : ''}.`),
  ];
}

// Options réellement présentes dans le schéma CONTACTS (Notion crée
// silencieusement toute option de select inconnue : on vérifie avant d'écrire).
let contactsSchema = { at: 0, data: null };
async function selectOptions(propName) {
  if (!contactsSchema.data || Date.now() - contactsSchema.at > 10 * 60_000) {
    contactsSchema = { at: Date.now(), data: await notion(`databases/${DB.contacts}`) };
  }
  const prop = contactsSchema.data.properties?.[propName];
  return (prop?.select?.options || []).map(o => o.name);
}

// Statuts que la soumission d'un dossier peut faire avancer vers « Inscrit »
// (on ne rétrograde jamais un Alumni, et on ne ressuscite pas un Perdu).
const STATUTS_AVANCABLES = ['', '🌱 Lead', '📞 Contacté', '💬 En discussion', '📝 Devis envoyé'];

// Retrouve le contact : identifiant du lien, sinon email, sinon création.
async function findContact(contactId, email) {
  if (contactId && /^[0-9a-f-]{32,36}$/i.test(contactId)) {
    try {
      const pg = await notion(`pages/${contactId}`);
      const parent = pg.parent?.database_id?.replace(/-/g, '');
      if (parent === DB.contacts.replace(/-/g, '')) return pg;
    } catch (err) {
      console.error('dossier-submit contact par id:', err.message);
    }
  }
  if (email) {
    const found = await queryAll(DB.contacts, {
      filter: { property: 'Email', email: { equals: email } },
    }, 1);
    if (found[0]) return found[0];
  }
  return null;
}

export async function saveDossierToContact(clean, meta) {
  const nomComplet = `${clean.prenom} ${(clean.nomUsage || clean.nomNaissance).toUpperCase()}`.trim();
  const existing = await findContact(meta.contactId, clean.email);

  // Le candidat vient de confirmer ses coordonnées : elles font foi.
  const properties = {
    'Email': { email: clean.email || null },
    'Téléphone': { phone_number: clean.telephone || null },
  };
  if (!clean.posteNonConcerne && clean.intitulePoste) {
    properties['Poste'] = { rich_text: txt(clean.intitulePoste) };
  }

  const statutsOk = await selectOptions('Statut pipeline');
  const statutActuel = existing?.properties?.['Statut pipeline']?.select?.name || '';
  if (statutsOk.includes('✅ Inscrit') && STATUTS_AVANCABLES.includes(statutActuel)) {
    properties['Statut pipeline'] = { select: { name: '✅ Inscrit' } };
  }

  let pageId;
  let pageUrl;
  if (existing) {
    const updated = await notion(`pages/${existing.id}`, { method: 'PATCH', body: { properties } });
    pageId = existing.id;
    pageUrl = updated.url || existing.url;
  } else {
    const typesOk = await selectOptions('Type');
    if (typesOk.includes('👤 Particulier')) properties['Type'] = { select: { name: '👤 Particulier' } };
    properties['Nom complet'] = { title: txt(nomComplet) };
    const created = await notion('pages', {
      method: 'POST',
      body: { parent: { database_id: DB.contacts }, properties },
    });
    pageId = created.id;
    pageUrl = created.url;
  }

  // Le détail du dossier va dans le CORPS de la fiche : rien n'est écrasé.
  await notion(`blocks/${pageId}/children`, {
    method: 'PATCH',
    body: { children: dossierBlocks(clean, meta) },
  });

  return { url: pageUrl || `https://www.notion.so/${String(pageId).replace(/-/g, '')}`, created: !existing };
}
