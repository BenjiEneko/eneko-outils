// ════════════════════════════════════════════════════════════════
//  api/_lib/relances.js  —  Moteur de relances du Cockpit Dossiers
//
//  UN SEUL fichier de règles, consommé par :
//   • /api/cockpit-dossiers action `relances` (vue « File de relances »)
//   • /api/cron-relances (récap Slack du lundi matin)
//
//  Chaque règle décrit : quand elle s'applique (à partir des données
//  Notion déjà chargées + quelques enrichissements bornés : liens
//  InKréa envoyés, sessions sans émargement, progression Circle), et
//  ce que Déborah doit faire — soit un EMAIL pré-rédigé à copier
//  (kind 'email'), soit une ACTION interne (kind 'action').
//
//  Les relances marquées « faites » sont mises en sommeil `snoozeDays`
//  jours (mémorisées dans le Blob privé, voir cockpit-dossiers).
//  Aucune relance n'est envoyée automatiquement : décision v1.
// ════════════════════════════════════════════════════════════════

const DAY = 86_400_000;
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);
const daysUntil = (iso) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / DAY) : null);
const hasEtape = (d, kw) => d.etapes.some(e => e.includes(kw));
const isClos = (d) => hasEtape(d, 'Clôturé') || (d.statutDossier || '').includes('Refusé');
const frDate = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const prenomDe = (nom) => (nom || '').split(/\s+/)[0] || '';

const SIGNATURE = '\n\nBelle journée,\nDéborah — Eneko Formation';

// ctx par dossier : { liens: [{url, pf, ageDays}], elearning: [{nom, statut, courses}],
//                     sessionsIncompletes: [{intitule, dateDebut, emargementOk, evalChaudFaite}] }
export const RULES = [
  {
    id: 'lien-inkrea-non-rempli',
    label: "Dossier d'inscription InKréa envoyé, non rempli",
    kind: 'email',
    severity: 2,
    snoozeDays: 5,
    applies: (d, ctx) => !isClos(d) && (ctx.liens || []).some(l => l.ageDays >= 5),
    detail: (d, ctx) => {
      const l = (ctx.liens || []).find(x => x.ageDays >= 5);
      return `Lien envoyé il y a ${l.ageDays} j à ${l.pf.prenom} ${l.pf.nomUsage}`.trim();
    },
    email: (d, ctx) => {
      const l = (ctx.liens || []).find(x => x.ageDays >= 5);
      return {
        objet: 'Votre dossier d\'inscription — Certification RS6776 (rappel)',
        corps: `Bonjour ${l.pf.prenom || ''},

Petit rappel : votre dossier d'inscription à la certification RS6776 n'est pas encore complété. Il ne prend que 3 minutes, vos informations sont déjà pré-remplies :
${l.url}

Ce lien est personnel et reste valable encore quelques jours. N'hésitez pas à me répondre si quelque chose bloque.${SIGNATURE}`,
      };
    },
  },
  {
    id: 'sans-etape',
    label: 'Dossier sans étape admin',
    kind: 'action',
    severity: 1,
    snoozeDays: 7,
    applies: (d) => !isClos(d) && d.etapes.length === 0 && (daysSince(d.createdTime) ?? 0) >= 3,
    detail: (d) => `Créé il y a ${daysSince(d.createdTime)} j — à qualifier (menu Étape sur la ligne)`,
  },
  {
    id: 'devis-convention-stagnant',
    label: 'Devis / convention à envoyer depuis plus de 5 jours',
    kind: 'action',
    severity: 2,
    snoozeDays: 5,
    applies: (d) => !isClos(d) && hasEtape(d, 'Devis/Convention') && !hasEtape(d, 'Dossier complet')
      && !hasEtape(d, 'Financement validé') && (daysSince(d.lastEdited) ?? 0) >= 5,
    detail: (d) => `Dernière modification il y a ${daysSince(d.lastEdited)} j — générer la convention depuis la fiche`,
  },
  {
    id: 'financement-en-attente',
    label: 'Financement en attente depuis plus de 10 jours',
    kind: 'action',
    severity: 2,
    snoozeDays: 7,
    applies: (d) => !isClos(d) && hasEtape(d, 'financement en attente') && !hasEtape(d, 'Financement validé')
      && (daysSince(d.lastEdited) ?? 0) >= 10,
    detail: (d) => `${d.financement || 'Financement ?'} — vérifier ${d.numEdof ? 'EDOF ' + d.numEdof : d.numOpco ? 'OPCO ' + d.numOpco : 'le dossier de financement'}`,
  },
  {
    id: 'convocation-a-envoyer',
    label: 'Convocation à envoyer',
    kind: 'action',
    severity: 3,
    snoozeDays: 3,
    applies: (d) => {
      if (isClos(d) || hasEtape(d, 'Convocation envoyée') || hasEtape(d, 'En formation') || hasEtape(d, 'terminée')) return false;
      const soon = d.dateDebut && daysUntil(d.dateDebut) <= 14 && daysUntil(d.dateDebut) >= -2;
      return hasEtape(d, 'Financement validé') || soon;
    },
    detail: (d) => d.dateDebut ? `Démarrage le ${frDate(d.dateDebut)} (dans ${daysUntil(d.dateDebut)} j)` : 'Financement validé, pas de date de début renseignée',
  },
  {
    id: 'elearning-non-demarre',
    label: 'E-learning pas démarré à l\'approche de la formation',
    kind: 'email',
    severity: 3,
    snoozeDays: 5,
    applies: (d, ctx) => {
      if (isClos(d) || !ctx.elearning) return false;
      return ctx.elearning.some(s => s.statut === 'non-membre' || (s.statut === 'ok' && s.courses.every(c => c.pct === 0)));
    },
    detail: (d, ctx) => ctx.elearning
      .filter(s => s.statut === 'non-membre' || (s.statut === 'ok' && s.courses.every(c => c.pct === 0)))
      .map(s => `${s.nom} : ${s.statut === 'non-membre' ? 'pas encore inscrit sur l\'académie' : '0 % des leçons'}`)
      .join(' · '),
    email: (d, ctx) => {
      const s = ctx.elearning.find(x => x.statut === 'non-membre' || (x.statut === 'ok' && x.courses.every(c => c.pct === 0)));
      return {
        objet: 'Votre parcours e-learning vous attend',
        corps: `Bonjour ${prenomDe(s?.nom)},

Votre formation ${d.dateDebut ? `démarre le ${frDate(d.dateDebut)}` : 'approche'} et votre espace e-learning est ouvert sur l'académie Eneko (academie.eneko.ai). Je vous invite à commencer les premiers modules dès maintenant : ils préparent les séances en groupe et vous feront gagner beaucoup en confort.

Si vous n'avez pas reçu votre invitation ou rencontrez une difficulté de connexion, répondez simplement à cet email.${SIGNATURE}`,
      };
    },
  },
  {
    id: 'attestation-a-envoyer',
    label: 'Formation terminée — attestation à envoyer',
    kind: 'action',
    severity: 2,
    snoozeDays: 5,
    applies: (d) => !isClos(d) && d.dateFin && daysSince(d.dateFin) >= 3 && !hasEtape(d, 'attestation envoyée'),
    detail: (d) => `Formation terminée le ${frDate(d.dateFin)} (il y a ${daysSince(d.dateFin)} j)`,
  },
  {
    id: 'emargement-eval-manquants',
    label: 'Session réalisée sans émargement ou sans évaluation à chaud',
    kind: 'action',
    severity: 2,
    snoozeDays: 7,
    applies: (d, ctx) => !isClos(d) && (ctx.sessionsIncompletes || []).length > 0,
    detail: (d, ctx) => ctx.sessionsIncompletes
      .map(s => `${s.intitule} (${frDate(s.dateDebut)}) : ${[!s.emargementOk && 'émargement', !s.evalChaudFaite && 'éval à chaud'].filter(Boolean).join(' + ')} manquant`)
      .join(' · '),
  },
  {
    id: 'paiement-retard',
    label: 'Paiement en retard ou limite de facturation dépassée',
    kind: 'email',
    severity: 3,
    snoozeDays: 7,
    applies: (d) => !isClos(d) && (
      (d.statutPaiement || '').includes('🔴') || (d.statutPaiement || '').includes('Litige') ||
      (d.dateLimiteFactu && daysSince(d.dateLimiteFactu) > 0 && !(d.statutPaiement || '').includes('Soldé'))
    ),
    detail: (d) => d.statutPaiement || `Limite de facturation dépassée (${frDate(d.dateLimiteFactu)})`,
    email: (d) => ({
      objet: `Facture ${d.numFacture || ''} — formation ${d.reference}`.replace(/\s+/g, ' ').trim(),
      corps: `Bonjour,

Sauf erreur de notre part, le règlement de la facture ${d.numFacture ? d.numFacture + ' ' : ''}relative à la formation ${d.reference}${d.montantHT ? ` (${d.montantHT.toLocaleString('fr-FR')} € HT)` : ''} ne nous est pas encore parvenu.

Pourriez-vous nous indiquer la date de règlement prévue, ou nous signaler si un élément vous manque pour procéder au paiement ?${SIGNATURE}`,
    }),
  },
];

/* ── Calcul ───────────────────────────────────────────────────── */

// dossiers : sortie de la liste cockpit ; enrich : (dossier) → ctx ;
// done : Map "<dossierId>|<ruleId>" → ISO date du « fait ».
export function computeRelances(dossiers, enrichFor = () => ({}), done = new Map()) {
  const out = [];
  for (const d of dossiers) {
    const ctx = enrichFor(d) || {};
    for (const rule of RULES) {
      let ok = false;
      try { ok = rule.applies(d, ctx); } catch { ok = false; }
      if (!ok) continue;
      const doneAt = done.get(`${d.id}|${rule.id}`);
      if (doneAt && daysSince(doneAt) < rule.snoozeDays) continue;
      let detail = '';
      let email = null;
      try { detail = rule.detail ? rule.detail(d, ctx) : ''; } catch { detail = ''; }
      try { email = rule.email ? rule.email(d, ctx) : null; } catch { email = null; }
      out.push({
        ruleId: rule.id,
        label: rule.label,
        kind: rule.kind,
        severity: rule.severity,
        dossierId: d.id,
        reference: d.reference,
        stagiaires: d.stagiaires,
        emails: d.stagiaireEmails || [],
        notionUrl: d.url,
        detail,
        email,
      });
    }
  }
  return out.sort((a, b) => b.severity - a.severity || a.label.localeCompare(b.label) || a.reference.localeCompare(b.reference));
}

// Regroupe par règle (pour l'UI et le digest Slack), ordre de sévérité.
export function groupByRule(relances) {
  const map = new Map();
  for (const r of relances) {
    if (!map.has(r.ruleId)) map.set(r.ruleId, { ruleId: r.ruleId, label: r.label, kind: r.kind, severity: r.severity, items: [] });
    map.get(r.ruleId).items.push(r);
  }
  return [...map.values()].sort((a, b) => b.severity - a.severity);
}
