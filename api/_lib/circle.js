// ════════════════════════════════════════════════════════════════
//  api/_lib/circle.js  —  Avancement e-learning des apprenants (Circle)
//
//  L'API Admin de Circle ne permet PAS de lire la progression d'un
//  membre (seulement de l'écrire). La lecture passe par l'API
//  Headless : un jeton « Headless Auth » (env CIRCLE_HEADLESS_TOKEN,
//  à créer dans Circle → Paramètres → Développeurs → Tokens) permet
//  d'obtenir un jeton MEMBRE par email, puis de lire ses cours avec
//  `progress.status` par leçon.
//
//  Cours suivis (IDs de l'académie academie.eneko.ai, override env) :
//   - IAG « Maîtriser l'IA générative »            → 2618650
//   - IAA « Automatisez vos process avec l'IA »    → 2618652
// ════════════════════════════════════════════════════════════════

const BASE = 'https://app.circle.so';

export const CIRCLE_COURSES = [
  { key: 'iag', label: "Maîtriser l'IA générative", spaceId: Number(process.env.CIRCLE_COURSE_IAG || 2618650), types: ['IAG'] },
  { key: 'iaa', label: "Automatisez vos process avec l'IA", spaceId: Number(process.env.CIRCLE_COURSE_IAA || 2618652), types: ['IAA'] },
];

export function circleConfigured() {
  return !!process.env.CIRCLE_HEADLESS_TOKEN;
}

/* ── Jetons membres (cache mémoire ~50 min par instance chaude) ── */

const memberTokens = new Map();

// Renvoie le jeton membre, ou null si l'email n'est pas membre Circle.
async function memberToken(email) {
  const cached = memberTokens.get(email);
  if (cached && cached.exp > Date.now()) return cached.token;

  const res = await fetch(`${BASE}/api/v1/headless/auth_token`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.CIRCLE_HEADLESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null; // pas membre du LMS
  if (!res.ok) throw new Error(`Circle auth_token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  memberTokens.set(email, { token: data.access_token, exp: Date.now() + 50 * 60_000 });
  if (memberTokens.size > 500) memberTokens.clear();
  return data.access_token;
}

/* ── Progression d'un cours pour un membre ────────────────────── */

// Renvoie { completed, total, pct } ou null si le membre n'a pas accès
// au cours (non inscrit à cet espace).
async function courseProgress(token, spaceId) {
  const res = await fetch(`${BASE}/api/headless/v1/courses/${spaceId}/sections?per_page=100`, {
    headers: { 'Authorization': `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Circle sections ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const sections = Array.isArray(data) ? data : (data.records || data.sections || []);
  let total = 0;
  let completed = 0;
  for (const section of sections) {
    for (const lesson of section.lessons || []) {
      total += 1;
      if (lesson.progress?.status === 'completed') completed += 1;
    }
  }
  if (!total) return null;
  return { completed, total, pct: Math.round((completed / total) * 100) };
}

/* ── Vue cockpit : progression d'une liste de stagiaires ──────── */

// typeFormation (Notion) → cours prioritaires ; les autres cours ne
// sont interrogés que si le type ne tranche pas (sur-mesure…).
function coursesFor(typeFormation) {
  const matching = CIRCLE_COURSES.filter(c => c.types.some(t => (typeFormation || '').includes(t)));
  return matching.length ? matching : CIRCLE_COURSES;
}

export async function elearningForStagiaires(stagiaires, typeFormation) {
  const courses = coursesFor(typeFormation);
  return Promise.all(stagiaires.map(async ({ nom, email }) => {
    if (!email) return { nom, statut: 'sans-email', courses: [] };
    try {
      const token = await memberToken(email);
      if (!token) return { nom, statut: 'non-membre', courses: [] };
      const results = [];
      for (const course of courses) {
        try {
          const progress = await courseProgress(token, course.spaceId);
          if (progress) results.push({ label: course.label, ...progress });
        } catch (err) {
          console.error(`circle progress ${course.key}:`, err.message);
        }
      }
      return { nom, statut: 'ok', courses: results };
    } catch (err) {
      console.error('circle member:', err.message);
      return { nom, statut: 'erreur', courses: [] };
    }
  }));
}
