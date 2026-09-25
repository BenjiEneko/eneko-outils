/* ════════════════════════════════════════════════════════════════
   assets/gate-code.js — Connexion en 2 étapes aux outils internes
   (email → code à 6 chiffres reçu par email → session de 7 jours).
   PARTAGÉ par le hub, le cockpit, l'émargement et le dossier
   d'inscription internes : tout correctif de la connexion se fait ICI.
   Le serveur (/api/auth) répond pareil que l'adresse soit autorisée
   ou non : le message reste volontairement neutre.

   Usage : EnekoGate({ form, input, button, message(text, kind), onSuccess({ email, token }) })
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  async function post(body) {
    const res = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  }

  window.EnekoGate = function ({ form, input, button, message, onSuccess, label = 'Accéder' }) {
    let etape = null; // { email, challenge } une fois le code demandé

    const autre = document.createElement('button');
    autre.type = 'button';
    autre.textContent = 'Autre adresse ou nouveau code';
    autre.hidden = true;
    autre.style.cssText = 'font:inherit;font-size:13px;background:none;border:0;color:inherit;opacity:.7;text-decoration:underline;cursor:pointer;margin-top:12px;padding:4px;';
    form.insertAdjacentElement('afterend', autre);
    // Même couleur que le texte saisi : lisible sur fond sombre comme clair.
    autre.style.color = getComputedStyle(input).color;

    function modeEmail(email) {
      etape = null;
      input.type = 'email'; input.required = true;
      input.removeAttribute('inputmode'); input.removeAttribute('maxlength');
      input.autocomplete = 'email';
      input.placeholder = input.dataset.placeholder || input.placeholder;
      input.value = email || '';
      button.textContent = label;
      autre.hidden = true;
      input.focus();
    }
    function modeCode() {
      input.dataset.placeholder = input.dataset.placeholder || input.placeholder;
      input.type = 'text'; input.value = '';
      input.setAttribute('inputmode', 'numeric'); input.setAttribute('maxlength', '6');
      input.autocomplete = 'one-time-code';
      input.placeholder = 'Code à 6 chiffres';
      button.textContent = 'Valider';
      autre.hidden = false;
      input.focus();
    }
    autre.addEventListener('click', () => { const e = etape?.email; message(''); modeEmail(e); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      message('');
      const valeur = input.value.trim();
      const texte = button.textContent;
      button.disabled = true; button.textContent = etape ? 'Vérification…' : 'Envoi du code…';
      try {
        if (!etape) {
          const { ok, data } = await post({ email: valeur });
          if (!ok || !data.challenge) { message(data.error || 'Envoi du code impossible.', 'error'); button.textContent = texte; return; }
          etape = { email: data.email, challenge: data.challenge };
          modeCode();
          message(`Si ${data.email} est autorisée, un code vient d'y être envoyé (valable 10 min — pensez aux spams).`, 'info');
        } else {
          const { ok, data } = await post({ challenge: etape.challenge, code: valeur });
          if (ok && data.token) {
            localStorage.setItem('eneko_email', data.email);
            localStorage.setItem('eneko_token', data.token);
            onSuccess({ email: data.email, token: data.token });
            modeEmail('');
            return;
          }
          message(data.error || 'Code incorrect.', 'error');
          if (data.expired) { modeEmail(etape.email); return; }
          button.textContent = texte; input.select();
        }
      } catch {
        message('Erreur de connexion. Réessayez.', 'error');
        button.textContent = texte;
      } finally {
        button.disabled = false;
      }
    });
  };
})();
