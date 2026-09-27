import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homePage, styleSheet, userPage, type InboxItem, type OutboxItem } from './pages.ts';
import { createTesseraClient, type Person } from './tessera.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

const tessera = createTesseraClient({
  apiUrl: required('TESSERA_API_URL'),
  publicUrl: required('TESSERA_PUBLIC_URL'),
  apiKey: required('TESSERA_API_KEY'),
  handoffSecret: required('TESSERA_HANDOFF_SECRET'),
});

type Slug = 'alice' | 'bruno';
const people: Record<Slug, Person> = {
  alice: { id: '42', name: 'Alice Martin' },
  bruno: { id: '7', name: 'Bruno Keller' },
};
const otherSlug = (slug: Slug): Slug => (slug === 'alice' ? 'bruno' : 'alice');

/** In-memory state of the demo App: what each person sent, and the codes they received. */
const inbox = new Map<string, InboxItem[]>();
const outbox = new Map<string, OutboxItem[]>();
const flash = new Map<string, string>();

const ERROR_TEXT: Record<string, string> = {
  INVALID_CODE: 'Code incorrect.',
  LOCKED: 'Trop d’essais : la demande est verrouillée.',
  EXPIRED: 'La demande a expiré.',
  ALREADY_APPROVED: 'Ce code a déjà été utilisé.',
  CANCELLED: 'La demande a été annulée.',
  NOT_FOUND: 'Demande introuvable.',
};

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return new URLSearchParams(body);
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'content-security-policy': "default-src 'self'; form-action 'self'",
    'referrer-policy': 'no-referrer',
  });
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location, 'referrer-policy': 'no-referrer' });
  response.end();
}

async function refreshStatuses(slug: Slug): Promise<OutboxItem[]> {
  const items = outbox.get(slug) ?? [];
  for (const item of items) {
    const answer = await tessera.get(item.id);
    if (answer.status === 200) item.status = String(answer.body.status);
  }
  return items;
}

async function createRequest(slug: Slug, form: URLSearchParams): Promise<void> {
  const me = people[slug];
  const other = people[otherSlug(slug)];
  const displayText = form.get('displayText') ?? '';
  const answer = await tessera.create({
    requester: me,
    approver: other,
    action: 'CHANGE_PROJECT_PRIORITY',
    displayText,
    context: { projectId: 'A', oldPriority: 3, newPriority: 1 },
    expiresInSeconds: Number(form.get('expiresInSeconds') ?? 600),
    authorizationDurationSeconds: 3600,
  });
  if (answer.status !== 201) {
    flash.set(slug, `Création refusée : ${String(answer.body.error)}`);
    return;
  }
  const { id, shortId, codeFormatted } = answer.body as {
    id: string;
    shortId: string;
    codeFormatted: string;
  };
  outbox.set(slug, [
    { id, shortId, to: other, displayText, status: 'PENDING' },
    ...(outbox.get(slug) ?? []),
  ]);
  // Tessera never sends anything: the App delivers the code to the approver by its own means.
  const received = inbox.get(otherSlug(slug)) ?? [];
  inbox.set(otherSlug(slug), [
    { requestId: id, shortId, code: codeFormatted, from: me, displayText },
    ...received,
  ]);
  flash.set(slug, `Demande ${shortId} envoyée à ${other.name}. Demandez-lui le code.`);
}

async function verifyRequest(slug: Slug, form: URLSearchParams): Promise<void> {
  const answer = await tessera.verify(form.get('id') ?? '', form.get('code') ?? '');
  if (answer.status === 200) {
    // The App checks WHAT was approved before executing the action.
    flash.set(
      slug,
      `Approuvé : action ${String(answer.body.action)} autorisée. L'App peut l'exécuter.`,
    );
    return;
  }
  const error = String(answer.body.error);
  const remaining = answer.body.attemptsRemaining;
  const suffix = typeof remaining === 'number' ? ` Essais restants : ${String(remaining)}.` : '';
  flash.set(slug, `${ERROR_TEXT[error] ?? error}${suffix}`);
}

async function userRoute(
  slug: Slug,
  action: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === 'GET' && action === '') {
    const page = userPage({
      me: people[slug],
      other: people[otherSlug(slug)],
      slug,
      inbox: inbox.get(slug) ?? [],
      outbox: await refreshStatuses(slug),
      flash: flash.get(slug) ?? null,
    });
    flash.delete(slug);
    send(response, 200, 'text/html', page);
  } else if (request.method === 'GET' && action === '/dashboard') {
    redirect(response, tessera.handoffUrl(people[slug]));
  } else if (request.method === 'POST') {
    const form = await readForm(request);
    if (action === '/request') await createRequest(slug, form);
    if (action === '/verify') await verifyRequest(slug, form);
    if (action === '/cancel') {
      const answer = await tessera.cancel(form.get('id') ?? '');
      const refused = `Annulation refusée : ${String(answer.body.error)}`;
      flash.set(slug, answer.status === 200 ? 'Demande annulée.' : refused);
    }
    redirect(response, `/as/${slug}`);
  } else {
    send(response, 405, 'text/plain', 'Method not allowed');
  }
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://demo');
  const match = /^\/as\/(alice|bruno)(\/[a-z]+)?$/.exec(url.pathname);
  if (url.pathname === '/') {
    const entries = (Object.keys(people) as Slug[]).map((slug) => ({ slug, person: people[slug] }));
    send(response, 200, 'text/html', homePage(entries));
  } else if (url.pathname === '/favicon.ico') {
    response.writeHead(204).end();
  } else if (url.pathname === '/style.css') {
    send(response, 200, 'text/css', styleSheet());
  } else if (match === null) {
    send(response, 404, 'text/plain', 'Not found');
  } else {
    await userRoute(match[1] as Slug, match[2] ?? '', request, response);
  }
}

const port = Number(process.env.PORT ?? 4000);
createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    console.error('demo error', error instanceof Error ? error.message : error);
    send(response, 502, 'text/plain', 'Tessera est injoignable.');
  });
}).listen(port, () => {
  console.log(`Demo App listening on http://localhost:${String(port)}`);
});
