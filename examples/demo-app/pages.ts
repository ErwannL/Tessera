import type { Person } from './tessera.ts';

export interface InboxItem {
  requestId: string;
  shortId: string;
  code: string;
  from: Person;
  displayText: string;
}

export interface OutboxItem {
  id: string;
  shortId: string;
  to: Person;
  displayText: string;
  status: string;
}

export interface PageModel {
  me: Person;
  other: Person;
  slug: string;
  inbox: InboxItem[];
  outbox: OutboxItem[];
  flash: string | null;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLE = `
body{font-family:system-ui,sans-serif;max-width:860px;margin:0 auto;padding:16px;line-height:1.5;color:#16161d}
section{border:1px solid #d9dbe6;border-radius:10px;padding:12px 16px;margin:16px 0}
.code{font-family:ui-monospace,monospace;font-size:1.4rem;letter-spacing:.15em;font-weight:700}
.flash{background:#eef2ff;border-color:#4338ca}
input,select,button{font:inherit;padding:4px 8px}
li{margin:8px 0}
`;

export function layout(title: string, body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><link rel="stylesheet" href="/style.css"></head>
<body>${body}</body></html>`;
}

export function styleSheet(): string {
  return STYLE;
}

export function homePage(people: { slug: string; person: Person }[]): string {
  const links = people
    .map(
      ({ slug, person }) =>
        `<li><a href="/as/${slug}">Entrer en tant que ${escapeHtml(person.name)}</a></li>`,
    )
    .join('');
  return layout(
    'Démo Tessera',
    `<h1>App de démonstration</h1>
<p>Cette mini-App simule une application qui utilise Tessera. Ouvrez les deux pages côte à côte.</p>
<ul>${links}</ul>`,
  );
}

function outboxList(model: PageModel): string {
  if (model.outbox.length === 0) return '<p>Aucune demande envoyée.</p>';
  const items = model.outbox
    .map(
      (item) => `<li data-request="${escapeHtml(item.shortId)}">
<strong>${escapeHtml(item.shortId)}</strong> → ${escapeHtml(item.to.name)} : ${escapeHtml(item.displayText)}
— état <span class="status">${escapeHtml(item.status)}</span>
${
  item.status === 'PENDING'
    ? `<form method="post" action="/as/${model.slug}/verify">
<input type="hidden" name="id" value="${escapeHtml(item.id)}">
<label>Code reçu de ${escapeHtml(item.to.name)} <input name="code" autocomplete="off" required></label>
<button type="submit">Valider le code</button></form>
<form method="post" action="/as/${model.slug}/cancel">
<input type="hidden" name="id" value="${escapeHtml(item.id)}"><button type="submit">Annuler</button></form>`
    : ''
}</li>`,
    )
    .join('');
  return `<ul>${items}</ul>`;
}

function inboxList(model: PageModel): string {
  if (model.inbox.length === 0) return '<p>Aucun code reçu.</p>';
  const items = model.inbox
    .map(
      (item) => `<li data-request="${escapeHtml(item.shortId)}">
${escapeHtml(item.from.name)} vous demande : « ${escapeHtml(item.displayText)} » (${escapeHtml(item.shortId)})<br>
Si vous êtes d'accord, donnez-lui ce code : <span class="code">${escapeHtml(item.code)}</span></li>`,
    )
    .join('');
  return `<ul>${items}</ul>`;
}

export function userPage(model: PageModel): string {
  const flash =
    model.flash === null
      ? ''
      : `<section class="flash" role="status">${escapeHtml(model.flash)}</section>`;
  return layout(
    `Démo — ${model.me.name}`,
    `<h1>Vous êtes ${escapeHtml(model.me.name)}</h1>
<p><a href="/">Changer d'utilisateur</a> · <a href="/as/${model.slug}/dashboard">Ouvrir mon tableau de bord Tessera</a></p>
${flash}
<section><h2>Demander l'autorisation de ${escapeHtml(model.other.name)}</h2>
<form method="post" action="/as/${model.slug}/request">
<label>Action demandée <input name="displayText" required maxlength="500"
 value="Passer « Projet A » de la priorité 3 à la priorité 1"></label>
<label>Expire dans (s) <input name="expiresInSeconds" type="number" value="600" min="1"></label>
<button type="submit">Demander l'autorisation de ${escapeHtml(model.other.name)}</button>
</form></section>
<section><h2>Mes demandes</h2>${outboxList(model)}</section>
<section><h2>Codes reçus (simule un email ou un SMS)</h2>${inboxList(model)}</section>`,
  );
}
