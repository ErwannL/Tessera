# Intégrer Tessera dans une App

Ce guide branche une App existante sur Tessera, pas à pas. Les exemples fonctionnent tels quels
contre la pile locale lancée par `make up` (Tessera sur `http://localhost:3000`).

Règle d'or : **seul le serveur de l'App parle à l'API de Tessera.** La clé API et les codes ne
doivent jamais atteindre un navigateur. Le navigateur ne voit Tessera que pour le tableau de bord
en lecture seule.

## 0. Préparer

Une instance de Tessera sert **une** App. La configuration de déploiement fournit :

- une clé API (`API_KEYS`) que le serveur de l'App envoie en `Authorization: Bearer <clé>` ;
- un secret de passation (`HANDOFF_SECRET`) partagé avec le serveur de l'App, qui signe les
  jetons d'ouverture du tableau de bord.

Avec la pile locale, ces valeurs sont dans `.env` (généré par `make up`) :

```sh
export TESSERA_URL=http://localhost:3000
export TESSERA_API_KEY=$(grep '^API_KEYS=' .env | cut -d= -f2 | cut -d, -f1)
export TESSERA_HANDOFF_SECRET=$(grep '^HANDOFF_SECRET=' .env | cut -d= -f2)
```

Les utilisateurs sont **vos** identifiants (chaînes opaques de 1 à 128 caractères) avec un nom
affichable. Tessera n'a pas de table d'utilisateurs et aucun rôle global : dans une demande, une
personne est demandeur ou approbateur, et les rôles peuvent être inversés dans une autre.

## 1. Créer une demande (A demande l'accord de B)

```sh
curl -s -X POST "$TESSERA_URL/api/v1/requests" \
  -H "Authorization: Bearer $TESSERA_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: priority-change-A-2026-09-27' \
  -d '{
    "requester": { "id": "42", "name": "Alice Martin" },
    "approver":  { "id": "7",  "name": "Bruno Keller" },
    "action": "CHANGE_PROJECT_PRIORITY",
    "displayText": "Alice demande de passer « Projet A » de la priorité 3 à la priorité 1",
    "context": { "projectId": "A", "oldPriority": 3, "newPriority": 1 },
    "expiresInSeconds": 600,
    "authorizationDurationSeconds": 3600,
    "maxAttempts": 5
  }'
```

Réponse `201` :

```json
{
  "id": "0b6f1c2e-…",
  "shortId": "8472-KQMX",
  "status": "PENDING",
  "code": "K7M4QX",
  "codeFormatted": "K7M-4QX",
  "expiresAt": "2026-09-27T14:42:01.000Z",
  "createdAt": "2026-09-27T14:32:01.000Z",
  "idempotentReplay": false
}
```

- **Le code n'est renvoyé qu'ici, une seule fois.** Tessera n'en garde qu'un HMAC.
- Conservez `id` : c'est lui qui désigne la demande à vérifier. Plusieurs demandes peuvent être
  en attente en même temps, dans les deux sens, entre les mêmes personnes : chaque code
  n'appartient qu'à **sa** demande.
- `Idempotency-Key` (optionnel) protège des doubles clics et des nouvelles tentatives réseau :
  le même appel renvoie la même demande avec `code: null` et `idempotentReplay: true` (HTTP 200) ;
  la même clé avec un autre corps renvoie `409 IDEMPOTENCY_CONFLICT`.

## 2. Transmettre le code à B, par vos propres moyens

Tessera n'envoie **rien**. Votre serveur remet `codeFormatted` à B par le canal de votre choix :
notification dans l'App, email, SMS… Le code se dicte facilement (pas de `0 O 1 I L`, groupes de
trois). Ne l'affichez jamais à A et ne l'envoyez jamais au navigateur de A.

## 3. B donne le code à A, qui le saisit dans l'App

Cette étape se passe hors de Tessera (oralement, par message…). Votre App affiche un champ de
saisie à A, puis son **serveur** vérifie :

```sh
curl -s -X POST "$TESSERA_URL/api/v1/requests/<id>/verify" \
  -H "Authorization: Bearer $TESSERA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "code": "k7m-4qx" }'
```

La saisie est normalisée (majuscules, espaces et tirets retirés). Succès `200` :

```json
{
  "id": "0b6f1c2e-…",
  "status": "APPROVED",
  "approvedAt": "2026-09-27T14:33:18.000Z",
  "requester": { "id": "42", "name": "Alice Martin" },
  "approver": { "id": "7", "name": "Bruno Keller" },
  "action": "CHANGE_PROJECT_PRIORITY",
  "context": { "projectId": "A", "oldPriority": 3, "newPriority": 1 },
  "authorizationDurationSeconds": 3600
}
```

**Avant d'exécuter l'action**, vérifiez que `action` et `context` correspondent bien à ce que vous
allez faire, et que `requester.id` est bien l'utilisateur connecté. Basez-vous sur le champ `error`
des échecs, jamais sur un message :

| HTTP | `error`            | Que faire                                                    |
| ---- | ------------------ | ------------------------------------------------------------ |
| 422  | `INVALID_CODE`     | mauvais code ; `attemptsRemaining` indique ce qu'il reste    |
| 423  | `LOCKED`           | trop d'essais : il faut une nouvelle demande                 |
| 410  | `EXPIRED`          | échéance passée : il faut une nouvelle demande               |
| 409  | `ALREADY_APPROVED` | le code a déjà servi (un code ne sert qu'une fois)           |
| 409  | `CANCELLED`        | la demande a été annulée                                     |
| 404  | `NOT_FOUND`        | identifiant inconnu                                          |
| 429  | `RATE_LIMITED`     | trop d'essais rapprochés (par demande et par IP) : patienter |

`authorizationDurationSeconds` est renvoyé tel quel : c'est à l'App d'en faire ce qu'elle veut
(par exemple, ouvrir une prise en main de session pendant une heure).

## 4. Annuler (optionnel)

```sh
curl -s -X POST "$TESSERA_URL/api/v1/requests/<id>/cancel" \
  -H "Authorization: Bearer $TESSERA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{ "reason": "Plus nécessaire" }'
```

Seule une demande `PENDING` s'annule (sinon `409 NOT_CANCELLABLE` avec l'état actuel). Annuler
deux fois renvoie `200` sans nouvel événement.

## 5. Consulter une demande et son historique

```sh
curl -s "$TESSERA_URL/api/v1/requests/<id>" -H "Authorization: Bearer $TESSERA_API_KEY"
curl -s "$TESSERA_URL/api/v1/requests/<id>/events" -H "Authorization: Bearer $TESSERA_API_KEY"
```

L'historique renvoie `chainValid` : `false` si une ligne a été modifiée ou supprimée.

## 6. Ouvrir le tableau de bord (passation)

L'utilisateur est déjà connecté à votre App. Votre **serveur** signe un JWT HS256 avec
`HANDOFF_SECRET`, valable **60 secondes au plus**, à usage unique, puis redirige le navigateur vers
`<PUBLIC_URL>/#handoff=<jwt>`. Le jeton voyage dans le fragment de l'URL : il n'est jamais envoyé
à un serveur, n'apparaît ni dans les journaux ni dans le `Referer`, et le tableau de bord l'efface
de la barre d'adresse dès son chargement.

Claims obligatoires : `sub` (identifiant de l'utilisateur dans l'App), `name`, `jti` (aléatoire,
16 caractères au moins), `iat`, `exp` (`exp - iat` ≤ 60), `aud: "tessera-dashboard"`.

## Exemple Node.js complet

Ce script (Node 22, aucune dépendance) déroule tout le parcours contre la pile locale. Enregistrez-le
sous `tessera-example.mjs`, puis lancez `node tessera-example.mjs` après les `export` de l'étape 0.

```js
import { createHmac, randomUUID } from 'node:crypto';

const TESSERA_URL = process.env.TESSERA_URL ?? 'http://localhost:3000';
const API_KEY = process.env.TESSERA_API_KEY;
const HANDOFF_SECRET = process.env.TESSERA_HANDOFF_SECRET;

/** Server-to-server call; the API key never leaves the App server. */
async function tessera(method, path, body) {
  const response = await fetch(`${TESSERA_URL}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${API_KEY}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/** Dashboard handoff URL: HS256 JWT, 60 seconds, single use, in the URL fragment. */
function dashboardUrl(user) {
  const b64 = (value) => Buffer.from(value).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64(
    JSON.stringify({
      sub: user.id,
      name: user.name,
      jti: randomUUID(),
      iat: now,
      exp: now + 60,
      aud: 'tessera-dashboard',
    }),
  );
  const signature = b64(
    createHmac('sha256', HANDOFF_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${TESSERA_URL}/#handoff=${header}.${payload}.${signature}`;
}

const alice = { id: '42', name: 'Alice Martin' };
const bruno = { id: '7', name: 'Bruno Keller' };

// 1. Alice asks Bruno.
const created = await tessera('POST', '/requests', {
  requester: alice,
  approver: bruno,
  action: 'CHANGE_PROJECT_PRIORITY',
  displayText: 'Alice demande de passer « Projet A » de la priorité 3 à la priorité 1',
  context: { projectId: 'A', oldPriority: 3, newPriority: 1 },
  expiresInSeconds: 600,
  authorizationDurationSeconds: 3600,
});
console.log('created', created.status, created.body.shortId);

// 2. The App delivers the code to Bruno by its own means (here: the console).
console.log(
  `Message to ${bruno.name}: give this code to ${alice.name} if you agree: ${created.body.codeFormatted}`,
);

// 3. Alice types a wrong code, then the one Bruno gave her.
const wrong = await tessera('POST', `/requests/${created.body.id}/verify`, { code: 'AAA-AAA' });
console.log('wrong code', wrong.status, wrong.body);
const verified = await tessera('POST', `/requests/${created.body.id}/verify`, {
  code: created.body.codeFormatted.toLowerCase(),
});
console.log('right code', verified.status, verified.body.status);

// 4. Check WHAT was approved before executing the action.
const approved =
  verified.status === 200 &&
  verified.body.action === 'CHANGE_PROJECT_PRIORITY' &&
  verified.body.requester.id === alice.id &&
  verified.body.context.newPriority === 1;
console.log(approved ? 'The App may now change the priority.' : 'Refused.');

// 5. History and dashboard.
const history = await tessera('GET', `/requests/${created.body.id}/events`);
console.log(
  'history',
  history.body.events.map((event) => event.type),
  'chainValid',
  history.body.chainValid,
);
console.log('Open the dashboard as Alice within 60 s:', dashboardUrl(alice));
```

L'App de démonstration (`examples/demo-app`) est l'intégration de référence complète, avec deux
pages simulant A et B : `make up PROFILE=demo`, puis <http://localhost:4000>.
