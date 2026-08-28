// Source JSX du calculateur — compilé en app.js (voir README.md, section Build).
// Ne pas éditer app.js directement : modifier ce fichier puis recompiler.
    const { useState, useRef, useEffect } = React;

    // ============================================================
    // CONSTANTES TUNABLES (valeurs testées dans le prototype)
    // ============================================================
    const BASE = 1900; // setup de base (inclut désormais charte graphique + transfert agent humain)
    const TJM_DEFAUT = 600;
    const URGENCE_PCT = 0.15;
    const HEURES_ETP_AN = 1600; // heures travaillées / an pour 1 ETP
    const JOURS_BASE = 1.5; // socle de mise en place (config, déploiement, tests)

    const MOTEUR = {
      script:     { label: "Script de qualification",  prix: 0,    jours: 0, retSocle: 80 },
      rag:        { label: "RAG sur documents métier",  prix: 1200, jours: 1, retSocle: 150 },
      rag_script: { label: "RAG + script combinés",     prix: 1600, jours: 1.5, retSocle: 180 },
    };

    // Catalogue intégrations : prix setup, retainer mensuel, jours.
    // prix:0 => inclus dans le pack de démarrage (affiché « inclus »).
    const INTEG = {
      crm:       { label: "CRM (HubSpot, Pipedrive, Salesforce)", prix: 600,  ret: 40, jours: 1 },
      agenda:    { label: "Prise de RDV (Cal.com, Calendly)",     prix: 450,  ret: 30, jours: 0.75 },
      notif:     { label: "Notif Slack / Teams / email",          prix: 250,  ret: 15, jours: 0.5 },
      db:        { label: "Base de données / SI métier",          prix: 1100, ret: 55, jours: 2 },
      ecommerce: { label: "E-commerce (Shopify, WooCommerce)",    prix: 900,  ret: 45, jours: 1.5 },
      ticketing: { label: "Helpdesk / ticketing (Zendesk…)",      prix: 750,  ret: 40, jours: 1.5 },
      paiement:  { label: "Paiement (Stripe)",                    prix: 700,  ret: 40, jours: 1 },
      sheets:    { label: "Google Sheets / Airtable",             prix: 300,  ret: 20, jours: 0.5 },
      kb:        { label: "Sources documentaires (Notion, Drive)",prix: 500,  ret: 35, jours: 1 },
      handoff:   { label: "Transfert vers agent humain (inclus)", prix: 0,    ret: 0,  jours: 0.5 },
      api:       { label: "API métier sur mesure",                prix: 1400, ret: 65, jours: 2.5 },
      webhook:   { label: "Webhook / n8n (automatisations)",      prix: 400,  ret: 25, jours: 1 },
    };

    const CANAUX = {
      whatsapp:  { label: "WhatsApp Business",            prix: 900,  ret: 55, jours: 1.5 },
      messenger: { label: "Messenger / Instagram DM",     prix: 750,  ret: 45, jours: 1.5 },
      telegram:  { label: "Telegram",                     prix: 500,  ret: 30, jours: 1 },
      teams:     { label: "Slack / Teams (interne)",      prix: 700,  ret: 40, jours: 1.5 },
      email:     { label: "Email automatisé",             prix: 500,  ret: 30, jours: 1 },
      mobile:    { label: "Intégration app mobile",       prix: 1200, ret: 55, jours: 2 },
    };

    const OPTIONS = {
      multilingue: { label: "Multilingue",                            prix: 700, ret: 35, jours: 1 },
      design:      { label: "Charte graphique / design (inclus)",     prix: 0,   ret: 0,  jours: 0.5 },
      voix_io:     { label: "Entrée / sortie vocale (STT-TTS)",       prix: 900, ret: 45, jours: 1.5 },
      analytics:   { label: "Dashboard analytics & reporting",        prix: 650, ret: 50, jours: 1 },
      memoire:     { label: "Mémoire / personnalisation utilisateur", prix: 700, ret: 35, jours: 1.5 },
      abtest:      { label: "A/B testing des réponses",               prix: 500, ret: 25, jours: 1 },
      rgpd:        { label: "Hébergement EU / conformité RGPD",       prix: 600, ret: 35, jours: 1 },
    };

    const VOLUME = {
      faible:     { label: "< 500 conv / mois",          api: 15,  hosting: 20 },
      moyen:      { label: "500 - 2 000 conv / mois",    api: 40,  hosting: 40 },
      eleve:      { label: "2 000 - 10 000 conv / mois", api: 150, hosting: 100 },
      tres_eleve: { label: "> 10 000 conv / mois",       api: 600, hosting: 300 },
    };

    const eur = (n) => Math.round(n).toLocaleString("fr-FR") + " €";

    const CONFIG_DEFAUT = {
      usage: "externe",
      moteur: "rag",
      // handoff (transfert agent humain) et design (charte graphique) sont
      // inclus dans le pack de démarrage : pré-cochés et facturés 0 €.
      integrations: ["notif", "handoff"],
      canaux: [],
      options: ["design"],
      volume: "moyen",
      urgence: false,
      roi: { convMois: 800, minutesParConv: 6, tauxAuto: 70 },
      synthese: "",
    };

    // Fusionne la config renvoyée par l'agent avec les valeurs par défaut, et
    // NORMALISE le ROI : l'agent peut renvoyer tauxAuto sous forme de fraction
    // (0.75) ou de pourcentage (75). On ramène toujours à un pourcentage 0-100,
    // sinon le calcul d'ETP serait ~100× faux. On filtre aussi les clés inconnues.
    function normaliserConfig(cfg) {
      const c = cfg || {};
      const roiIn = c.roi || {};
      let taux = Number(roiIn.tauxAuto);
      if (!isFinite(taux)) taux = CONFIG_DEFAUT.roi.tauxAuto;
      if (taux > 0 && taux <= 1) taux = taux * 100;        // fraction → pourcentage
      taux = Math.max(0, Math.min(100, Math.round(taux))); // borne 0-100
      const num = (v, def) => (isFinite(Number(v)) ? Number(v) : def);
      return {
        ...CONFIG_DEFAUT,
        ...c,
        // On ne garde que les clés de catalogue valides (robustesse).
        moteur: MOTEUR[c.moteur] ? c.moteur : CONFIG_DEFAUT.moteur,
        volume: VOLUME[c.volume] ? c.volume : CONFIG_DEFAUT.volume,
        integrations: (c.integrations || []).filter((k) => INTEG[k]),
        canaux: (c.canaux || []).filter((k) => CANAUX[k]),
        options: (c.options || []).filter((k) => OPTIONS[k]),
        roi: {
          convMois: num(roiIn.convMois, CONFIG_DEFAUT.roi.convMois),
          minutesParConv: num(roiIn.minutesParConv, CONFIG_DEFAUT.roi.minutesParConv),
          tauxAuto: taux,
        },
      };
    }

    // Mode prospect (version light) : accessible sans gate.
    // On le déclenche sur le slug public dédié (/simulateur-chatbot, servi par un
    // rewrite Vercel) — ce qui évite de laisser deviner l'URL interne — ou, en
    // secours, via ?client sur n'importe quelle URL.
    const PARAMS = new URLSearchParams(window.location.search);
    const MODE_PROSPECT =
      /simulateur/i.test(window.location.pathname) ||
      PARAMS.has("client") ||
      PARAMS.get("vue") === "client";

    // ============================================================
    // RACINE : gère le gate (vue interne) ou l'accès direct (prospect)
    // ============================================================
    function Root() {
      // En mode prospect, pas de gate du tout.
      const [authed, setAuthed] = useState(MODE_PROSPECT);
      const [checking, setChecking] = useState(!MODE_PROSPECT);

      useEffect(() => {
        if (MODE_PROSPECT) return;
        const email = localStorage.getItem("eneko_email");
        const token = localStorage.getItem("eneko_token");
        if (!email || !token) { setChecking(false); return; }
        fetch("/api/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, token }),
        })
          .then((r) => r.json())
          .then((d) => setAuthed(!!d.valid))
          .catch(() => {})
          .finally(() => setChecking(false));
      }, []);

      if (checking) {
        return (
          <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
            Chargement…
          </div>
        );
      }
      if (!authed) return <Gate onOk={() => setAuthed(true)} />;
      return <App prospect={MODE_PROSPECT} />;
    }

    // ============================================================
    // GATE — accès interne réservé (réutilise /api/auth + /api/verify)
    // ============================================================
    function Gate({ onOk }) {
      const [email, setEmail] = useState("");
      const [loading, setLoading] = useState(false);
      const [erreur, setErreur] = useState("");

      const submit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setErreur("");
        try {
          const res = await fetch("/api/auth", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim() }),
          });
          const data = await res.json();
          if (res.ok && data.token) {
            localStorage.setItem("eneko_email", data.email);
            localStorage.setItem("eneko_token", data.token);
            onOk();
          } else {
            setErreur(data.error || "Accès refusé.");
          }
        } catch {
          setErreur("Erreur de connexion. Réessayez.");
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="min-h-screen bg-midnight flex flex-col items-center justify-center p-6">
          <a href="https://eneko.ai/" target="_blank" rel="noopener" className="mb-10">
            <img src="/assets/logo-eneko-blanc.svg" alt="Eneko" className="h-8" />
          </a>
          <div className="bg-white/5 border border-white/10 rounded-3xl p-10 w-full max-w-md text-center">
            <div className="text-4xl mb-5">🔐</div>
            <h2 className="text-xl font-semibold text-white mb-2 font-display">Espace réservé</h2>
            <p className="text-sm text-white/50 mb-6 leading-relaxed">
              Outil interne de cadrage & devis. Renseignez votre adresse e-mail autorisée pour continuer.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="votre@email.fr" autoComplete="email"
                className="w-full bg-white/10 border border-white/15 rounded-xl px-4 py-3 text-white placeholder-white/40 outline-none focus:border-indigo-500" />
              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3 font-medium transition disabled:opacity-50">
                {loading ? "Vérification…" : "Accéder"}
              </button>
              {erreur && <p className="text-sm text-red-300 bg-red-500/10 rounded-lg px-3 py-2">{erreur}</p>}
            </form>
          </div>
        </div>
      );
    }

    // ============================================================
    // APP
    // ============================================================
    function App({ prospect }) {
      // En mode prospect, la vue est verrouillée sur « client ».
      const [vue, setVue] = useState(prospect ? "client" : "interne");
      const [etape, setEtape] = useState("chat");
      const [config, setConfig] = useState(CONFIG_DEFAUT);
      const [tjm, setTjm] = useState(TJM_DEFAUT);
      const [ovSetup, setOvSetup] = useState("");
      const [ovRetainer, setOvRetainer] = useState("");
      const [ovJours, setOvJours] = useState(""); // override manuel de la charge (jours)

      return (
        <div className="min-h-screen bg-paper">
          <div className="max-w-5xl mx-auto p-4 sm:p-6">
            <header className="flex items-center justify-between mb-5">
              <div>
                <div className="text-indigo-600 font-semibold text-sm">Eneko · Studio IA</div>
                <h1 className="text-xl font-bold text-slate-900 font-display">
                  {prospect ? "Votre projet de chatbot IA" : "Cadrage & devis chatbot"}
                </h1>
              </div>
              {/* Le sélecteur de vue n'apparaît qu'en interne (jamais pour un prospect) */}
              {!prospect && etape === "propal" && (
                <div className="flex gap-1 bg-slate-200 p-1 rounded-xl text-sm">
                  {[["interne", "Vue interne"], ["client", "Vue client"]].map(([k, l]) => (
                    <button key={k} onClick={() => setVue(k)}
                      className={"px-3 py-1.5 rounded-lg font-medium transition " + (vue === k ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </header>

            {etape === "chat" ? (
              <Chat
                prospect={prospect}
                onDone={(cfg) => { setConfig(normaliserConfig(cfg)); setEtape("propal"); }}
                onSkip={() => setEtape("propal")}
              />
            ) : (
              <Propal
                vue={vue} prospect={prospect} config={config} setConfig={setConfig}
                tjm={tjm} setTjm={setTjm}
                ovSetup={ovSetup} setOvSetup={setOvSetup}
                ovRetainer={ovRetainer} setOvRetainer={setOvRetainer}
                ovJours={ovJours} setOvJours={setOvJours}
                onRestart={() => setEtape("chat")}
              />
            )}
          </div>
        </div>
      );
    }

    // ============================================================
    // ÉTAPE 1 — AGENT DE CADRAGE (via /api/calculateur-chat)
    // ============================================================
    function Chat({ onDone, onSkip, prospect }) {
      const [messages, setMessages] = useState([
        { role: "assistant", content: "Bonjour ! Pour cadrer votre projet de chatbot, dites-moi d'abord : à qui s'adresse-t-il, vos clients ou vos équipes en interne, et quelle tâche principale doit-il prendre en charge ?" },
      ]);
      const [input, setInput] = useState("");
      const [loading, setLoading] = useState(false);
      const [erreur, setErreur] = useState("");
      const endRef = useRef(null);

      useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

      const send = async () => {
        if (!input.trim() || loading) return;
        const next = [...messages, { role: "user", content: input.trim() }];
        setMessages(next);
        setInput("");
        setLoading(true);
        setErreur("");
        try {
          const res = await fetch("/api/calculateur-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
            signal: AbortSignal.timeout(30000),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "erreur");
          setMessages((p) => [...p, { role: "assistant", content: data.message || "J'ai préparé votre proposition." }]);
          if (data.config) setTimeout(() => onDone(data.config), 700);
        } catch (e) {
          setErreur("Agent de cadrage indisponible. Vous pouvez passer directement au " + (prospect ? "configurateur." : "formulaire."));
        } finally {
          setLoading(false);
        }
      };

      return (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 flex flex-col" style={{ height: "70vh" }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={"flex " + (m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={"max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed " +
                  (m.role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-slate-100 text-slate-800 rounded-bl-sm")}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1">
                  <Dot /> <Dot d="150" /> <Dot d="300" />
                </div>
              </div>
            )}
            {erreur && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">{erreur}</p>}
            <div ref={endRef} />
          </div>
          <div className="border-t border-slate-100 p-3">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="Votre réponse…"
                className="flex-1 border border-slate-300 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
              />
              <button onClick={send} disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 rounded-xl font-medium text-sm disabled:opacity-50 transition">
                Envoyer
              </button>
            </div>
            <button onClick={onSkip} className="text-xs text-slate-400 mt-2 underline">
              Passer directement au {prospect ? "configurateur" : "formulaire"}
            </button>
          </div>
        </div>
      );
    }

    function Dot({ d = "0" }) {
      return <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: d + "ms" }} />;
    }

    // ============================================================
    // ÉTAPE 2 — PROPOSITION
    // ============================================================
    function Propal({ vue, prospect, config, setConfig, tjm, setTjm, ovSetup, setOvSetup, ovRetainer, setOvRetainer, ovJours, setOvJours, onRestart }) {
      const interne = vue === "interne";
      const c = config;
      const toggleArr = (champ, k) =>
        setConfig((p) => ({ ...p, [champ]: p[champ].includes(k) ? p[champ].filter((x) => x !== k) : [...p[champ], k] }));

      const setupHU =
        BASE + MOTEUR[c.moteur].prix +
        c.integrations.reduce((s, k) => s + (INTEG[k]?.prix || 0), 0) +
        c.canaux.reduce((s, k) => s + (CANAUX[k]?.prix || 0), 0) +
        c.options.reduce((s, k) => s + (OPTIONS[k]?.prix || 0), 0);
      const setupAuto = setupHU * (c.urgence ? 1 + URGENCE_PCT : 1);

      // Charge auto, recalculée à chaque changement de config…
      const joursAuto =
        JOURS_BASE + MOTEUR[c.moteur].jours +
        c.integrations.reduce((s, k) => s + (INTEG[k]?.jours || 0), 0) +
        c.canaux.reduce((s, k) => s + (CANAUX[k]?.jours || 0), 0) +
        c.options.reduce((s, k) => s + (OPTIONS[k]?.jours || 0), 0);
      // …mais surchargeable manuellement (champ éditable côté interne).
      const jours = ovJours !== "" ? Number(ovJours) : joursAuto;
      const coutInterne = jours * tjm;

      const retainerAuto =
        MOTEUR[c.moteur].retSocle +
        c.integrations.reduce((s, k) => s + (INTEG[k]?.ret || 0), 0) +
        c.canaux.reduce((s, k) => s + (CANAUX[k]?.ret || 0), 0) +
        c.options.reduce((s, k) => s + (OPTIONS[k]?.ret || 0), 0);
      const refacture = VOLUME[c.volume].api + VOLUME[c.volume].hosting;

      const setupFinal = ovSetup !== "" ? Number(ovSetup) : setupAuto;
      const retainerFinal = ovRetainer !== "" ? Number(ovRetainer) : retainerAuto;
      const marge = setupFinal - coutInterne;
      const margePct = setupFinal > 0 ? (marge / setupFinal) * 100 : 0;
      const niveau = setupFinal < 4000 ? 1 : setupFinal <= 8500 ? 2 : 3;
      const annee1 = setupFinal + (retainerFinal + refacture) * 12;

      const r = c.roi;
      const heuresMois = (r.convMois * r.minutesParConv * (r.tauxAuto / 100)) / 60;
      const heuresAn = heuresMois * 12;
      const etp = heuresAn / HEURES_ETP_AN;

      const margeColor = margePct >= 50 ? "text-emerald-600" : margePct >= 30 ? "text-amber-600" : "text-red-600";
      const px = (txt) => (interne ? txt : null);

      // Récapitulatif transmis à la fonction d'envoi d'email (libellés + montants formatés).
      const summary = {
        vue,
        synthese: c.synthese,
        recap: {
          usage: c.usage === "interne" ? "Interne (collaborateurs)" : "Externe (clients)",
          moteur: MOTEUR[c.moteur].label,
          volume: VOLUME[c.volume].label,
          urgence: c.urgence,
        },
        listes: {
          integrations: c.integrations.map((k) => INTEG[k]?.label).filter(Boolean),
          canaux: c.canaux.map((k) => CANAUX[k]?.label).filter(Boolean),
          options: c.options.map((k) => OPTIONS[k]?.label).filter(Boolean),
        },
        roi: {
          etp: etp.toFixed(2) + " ETP",
          heuresMois: Math.round(heuresMois) + " h / mois",
          heuresAn: Math.round(heuresAn) + " h / an",
        },
        pricing: interne
          ? {
              setup: eur(setupFinal),
              retainer: eur(retainerFinal),
              refacture: eur(refacture) + " / mois",
              annee1: eur(annee1),
              jours: jours.toFixed(1) + " j",
              coutInterne: eur(coutInterne),
              marge: eur(marge),
              margePct: margePct.toFixed(0) + " %",
            }
          : {
              setup: eur(setupFinal),
              retainer: eur(retainerFinal),
              refacture: eur(refacture) + " / mois",
              annee1: eur(annee1),
            },
      };

      // Bloc « gain de temps » réutilisé (mis en avant pour les prospects).
      const blocGain = (
        <Card title="Gain de temps estimé">
          <div className="grid grid-cols-3 gap-2 mb-3">
            <MiniInput label="Conv. / mois" value={r.convMois} onChange={(v) => setConfig((p) => ({ ...p, roi: { ...p.roi, convMois: v } }))} />
            <MiniInput label="Min. / conv." value={r.minutesParConv} onChange={(v) => setConfig((p) => ({ ...p, roi: { ...p.roi, minutesParConv: v } }))} />
            <MiniInput label="% automatisé" value={r.tauxAuto} onChange={(v) => setConfig((p) => ({ ...p, roi: { ...p.roi, tauxAuto: v } }))} />
          </div>
          <div className="bg-emerald-50 rounded-2xl p-4">
            <div className="text-center mb-3">
              <div className="text-3xl font-bold text-emerald-700">{etp.toFixed(2)} ETP</div>
              <div className="text-xs text-emerald-600">libéré sur l'année ({Math.round(etp * 100)}% d'un poste)</div>
            </div>
            <Line label="Temps économisé" value={Math.round(heuresMois) + " h / mois"} />
            <Line label="Sur l'année" value={Math.round(heuresAn) + " h / an"} />
          </div>
        </Card>
      );

      return (
        <div className="space-y-6">
          {/* Bandeau gain mis en avant pour les prospects (version light) */}
          {prospect && (
            <div className="bg-emerald-600 text-white rounded-3xl p-6 shadow-lg text-center">
              <div className="text-emerald-100 text-sm font-medium mb-1">Votre gain de temps estimé</div>
              <div className="text-5xl font-bold mb-1">{etp.toFixed(2)} ETP</div>
              <div className="text-emerald-100 text-sm">
                soit ~{Math.round(heuresMois)} h économisées chaque mois ({Math.round(heuresAn)} h / an)
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-5">
              {c.synthese && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-3 text-sm text-indigo-900">
                  {c.synthese}
                </div>
              )}

              {!prospect && (
                <Card title="Usage">
                  <Seg value={c.usage} onChange={(v) => setConfig((p) => ({ ...p, usage: v }))}
                    options={[["interne", "Interne"], ["externe", "Externe"]]} />
                </Card>
              )}

              <Card title="Moteur de réponse">
                {Object.entries(MOTEUR).map(([k, v]) => (
                  <Row key={k} type="radio" checked={c.moteur === k} onClick={() => setConfig((p) => ({ ...p, moteur: k }))}
                    label={v.label} price={px(v.prix ? "+" + eur(v.prix) : "inclus")} />
                ))}
              </Card>

              <Card title="Intégrations">
                {Object.entries(INTEG).map(([k, v]) => (
                  <Row key={k} checked={c.integrations.includes(k)} onClick={() => toggleArr("integrations", k)}
                    label={v.label} price={px(v.prix ? "+" + eur(v.prix) : "inclus")} />
                ))}
              </Card>

              <Card title="Canaux (widget site inclus)">
                {Object.entries(CANAUX).map(([k, v]) => (
                  <Row key={k} checked={c.canaux.includes(k)} onClick={() => toggleArr("canaux", k)}
                    label={v.label} price={px(v.prix ? "+" + eur(v.prix) : "inclus")} />
                ))}
              </Card>

              <Card title="Options">
                {Object.entries(OPTIONS).map(([k, v]) => (
                  <Row key={k} checked={c.options.includes(k)} onClick={() => toggleArr("options", k)}
                    label={v.label} price={px(v.prix ? "+" + eur(v.prix) : "inclus")} />
                ))}
                <Row checked={c.urgence} onClick={() => setConfig((p) => ({ ...p, urgence: !p.urgence }))}
                  label="Urgence (< 2 semaines)" price={px("+" + URGENCE_PCT * 100 + "%")} />
              </Card>

              <Card title="Volume estimé">
                {Object.entries(VOLUME).map(([k, v]) => (
                  <Row key={k} type="radio" checked={c.volume === k} onClick={() => setConfig((p) => ({ ...p, volume: k }))}
                    label={v.label} price={px("~" + eur(v.api + v.hosting) + "/mois")} />
                ))}
              </Card>

              <button onClick={onRestart} className="text-sm text-indigo-600 underline">
                Relancer le cadrage avec l'agent
              </button>
            </div>

            <div className="space-y-5">
              {/* Pour les prospects, on montre le gain en premier */}
              {prospect && blocGain}

              <div className="bg-indigo-600 text-white rounded-3xl p-5 shadow-lg sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-indigo-100 text-sm font-medium">{prospect ? "Estimation" : "Proposition"}</span>
                  <span className="bg-white/20 px-3 py-1 rounded-full text-sm font-semibold">Niveau {niveau}</span>
                </div>

                <div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-indigo-100 text-sm">Setup HT</span>
                    {interne && <span className="text-xs text-indigo-200">auto : {eur(setupAuto)}</span>}
                  </div>
                  {interne ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" value={ovSetup} onChange={(e) => setOvSetup(e.target.value)}
                        placeholder={Math.round(setupAuto)}
                        className="w-full bg-white/15 rounded-lg px-3 py-2 text-2xl font-bold text-white placeholder-white/70 outline-none" />
                      {ovSetup !== "" && <button onClick={() => setOvSetup("")} className="text-indigo-200 text-xs">reset</button>}
                    </div>
                  ) : (
                    <div className="text-2xl font-bold mt-1">{eur(setupFinal)}</div>
                  )}
                </div>

                <div className="border-t border-white/15 pt-4 mt-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-indigo-100 text-sm">Abonnement HT / mois</span>
                    {interne && <span className="text-xs text-indigo-200">auto : {eur(retainerAuto)}</span>}
                  </div>
                  {interne ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input type="number" value={ovRetainer} onChange={(e) => setOvRetainer(e.target.value)}
                        placeholder={Math.round(retainerAuto)}
                        className="w-full bg-white/15 rounded-lg px-3 py-2 text-lg font-bold text-white placeholder-white/70 outline-none" />
                      {ovRetainer !== "" && <button onClick={() => setOvRetainer("")} className="text-indigo-200 text-xs">reset</button>}
                    </div>
                  ) : (
                    <div className="text-lg font-bold mt-1">{eur(retainerFinal)}</div>
                  )}
                  <div className="flex justify-between text-sm text-indigo-100 mt-2">
                    <span>+ API & hébergement{interne ? " (à coût)" : ""}</span>
                    <span className="font-semibold">{eur(refacture)}/mois</span>
                  </div>
                </div>

                <div className="border-t border-white/15 pt-4 mt-4 flex justify-between items-baseline">
                  <span className="text-indigo-100 text-sm">Total année 1</span>
                  <span className="text-xl font-bold">{eur(annee1)}</span>
                </div>
              </div>

              {/* Bloc gain en position normale pour la vue interne/client */}
              {!prospect && blocGain}

              {interne && (
                <Card title="Marge interne (ne pas montrer au client)">
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm text-slate-600">TJM consultant</label>
                    <div className="flex items-center gap-2">
                      <input type="number" value={tjm} onChange={(e) => setTjm(Number(e.target.value))}
                        className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-right text-sm" />
                      <span className="text-sm text-slate-500">/j</span>
                    </div>
                  </div>
                  {/* Charge estimée : éditable, avec valeur auto en repère */}
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-slate-600">
                      Charge estimée
                      <span className="text-xs text-slate-400 ml-1">auto : {joursAuto.toFixed(1)} j</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input type="number" step="0.5" min="0" value={ovJours}
                        onChange={(e) => setOvJours(e.target.value)}
                        placeholder={joursAuto.toFixed(1)}
                        className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-right text-sm outline-none focus:border-indigo-500" />
                      <span className="text-sm text-slate-500">j</span>
                      {ovJours !== "" && (
                        <button onClick={() => setOvJours("")} className="text-indigo-600 text-xs">reset</button>
                      )}
                    </div>
                  </div>
                  <Line label="Coût interne setup" value={eur(coutInterne)} />
                  <Line label="Marge setup" value={eur(marge)} strong />
                  <div className="flex justify-between items-baseline mt-2 pt-3 border-t border-slate-100">
                    <span className="text-sm text-slate-600">Marge %</span>
                    <span className={"text-2xl font-bold " + margeColor}>{margePct.toFixed(0)}%</span>
                  </div>
                </Card>
              )}

              {interne && (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3 text-xs text-amber-800">
                  Ce chatbot est une porte d'entrée. L'objectif réel : basculer ce client vers une formation
                  OPCO ou un groupe, où se fait la marge récurrente.
                </div>
              )}
            </div>
          </div>

          {/* Envoi du récapitulatif par email */}
          <EnvoiEmail summary={summary} prospect={prospect} />
        </div>
      );
    }

    // ============================================================
    // ENVOI EMAIL — capture le contact + envoie le récap à Eneko
    // ============================================================
    function EnvoiEmail({ summary, prospect }) {
      const [open, setOpen] = useState(false);
      const [form, setForm] = useState({ prenom: "", nom: "", email: "", telephone: "" });
      const [statut, setStatut] = useState("idle"); // idle | sending | ok | error
      const [erreur, setErreur] = useState("");

      const champ = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
      const complet = form.prenom.trim() && form.nom.trim() && form.email.trim() && form.telephone.trim();

      const envoyer = async () => {
        if (!complet || statut === "sending") return;
        setStatut("sending");
        setErreur("");
        try {
          const res = await fetch("/api/calculateur-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...summary, lead: form }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Échec de l'envoi.");
          setStatut("ok");
        } catch (e) {
          setStatut("error");
          setErreur(e.message || "Échec de l'envoi.");
        }
      };

      if (statut === "ok") {
        return (
          <div className="bg-emerald-50 border border-emerald-200 rounded-3xl p-6 text-center">
            <div className="text-3xl mb-2">✅</div>
            <p className="text-emerald-800 font-medium">
              {prospect ? "Merci ! Votre demande a bien été transmise." : "Récapitulatif envoyé à Eneko."}
            </p>
            <p className="text-sm text-emerald-600 mt-1">
              {prospect ? "L'équipe Eneko vous recontacte très vite." : "L'email est parti sur bonjour@eneko-formation.fr."}
            </p>
          </div>
        );
      }

      return (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
          {!open ? (
            <div className="text-center">
              <h3 className="font-semibold text-slate-800 mb-1 font-display text-lg">
                {prospect ? "Recevoir cette estimation / être recontacté" : "Envoyer ce récapitulatif par email"}
              </h3>
              <p className="text-sm text-slate-500 mb-4">
                {prospect
                  ? "Laissez vos coordonnées, l'équipe Eneko revient vers vous avec une proposition détaillée."
                  : "Le récapitulatif complet est envoyé à bonjour@eneko-formation.fr."}
              </p>
              <button onClick={() => setOpen(true)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition">
                {prospect ? "Je laisse mes coordonnées" : "Envoyer par email"}
              </button>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-slate-800 mb-4 font-display text-lg">Vos coordonnées</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Prénom" value={form.prenom} onChange={champ("prenom")} placeholder="Marie" />
                <Field label="Nom" value={form.nom} onChange={champ("nom")} placeholder="Dupont" />
                <Field label="Email" type="email" value={form.email} onChange={champ("email")} placeholder="marie@entreprise.fr" />
                <Field label="Téléphone" type="tel" value={form.telephone} onChange={champ("telephone")} placeholder="06 12 34 56 78" />
              </div>
              {erreur && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mt-3">{erreur}</p>}
              <div className="flex items-center gap-3 mt-4">
                <button onClick={envoyer} disabled={!complet || statut === "sending"}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-medium transition disabled:opacity-40">
                  {statut === "sending" ? "Envoi…" : "Envoyer"}
                </button>
                <button onClick={() => setOpen(false)} className="text-sm text-slate-400 underline">Annuler</button>
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Tous les champs sont obligatoires. Vos données servent uniquement au suivi commercial Eneko.
              </p>
            </div>
          )}
        </div>
      );
    }

    // ============================================================
    // UI
    // ============================================================
    function Card({ title, children }) {
      return (
        <div className="bg-white rounded-3xl p-4 shadow-sm border border-slate-100">
          <h3 className="font-semibold text-slate-800 text-sm mb-3">{title}</h3>
          <div className="space-y-2">{children}</div>
        </div>
      );
    }

    function Seg({ value, onChange, options }) {
      return (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {options.map(([k, l]) => (
            <button key={k} onClick={() => onChange(k)}
              className={"flex-1 py-2 rounded-lg text-sm font-medium transition " + (value === k ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500")}>
              {l}
            </button>
          ))}
        </div>
      );
    }

    function Row({ checked, onClick, label, price, type = "check" }) {
      return (
        <button onClick={onClick}
          className={"w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-left transition " +
            (checked ? "border-indigo-500 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300")}>
          <span className="flex items-center gap-2">
            <span className={(type === "radio" ? "rounded-full " : "rounded ") + "w-4 h-4 border-2 flex items-center justify-center shrink-0 " +
              (checked ? (type === "radio" ? "border-indigo-600" : "border-indigo-600 bg-indigo-600") : "border-slate-300")}>
              {checked && (type === "radio" ? <span className="w-2 h-2 rounded-full bg-indigo-600" /> : <span className="text-white text-xs leading-none">✓</span>)}
            </span>
            <span className="text-sm text-slate-700">{label}</span>
          </span>
          {price && <span className="text-xs font-medium text-slate-400 shrink-0 ml-2">{price}</span>}
        </button>
      );
    }

    function MiniInput({ label, value, onChange }) {
      return (
        <div>
          <label className="text-xs text-slate-500 block mb-1">{label}</label>
          <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm outline-none focus:border-indigo-500" />
        </div>
      );
    }

    function Field({ label, value, onChange, placeholder, type = "text" }) {
      return (
        <div>
          <label className="text-xs text-slate-500 block mb-1">{label}</label>
          <input type={type} value={value} onChange={onChange} placeholder={placeholder}
            className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-indigo-500" />
        </div>
      );
    }

    function Line({ label, value, strong }) {
      return (
        <div className="flex justify-between text-sm py-0.5">
          <span className="text-slate-500">{label}</span>
          <span className={strong ? "font-semibold text-slate-900" : "text-slate-700"}>{value}</span>
        </div>
      );
    }

    ReactDOM.createRoot(document.getElementById("root")).render(<Root />);
