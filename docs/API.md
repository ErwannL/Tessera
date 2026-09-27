# Référence de l'API

- Base : `/api/v1`, JSON uniquement (`Content-Type: application/json`), corps limités à 16 Ko.
- Document **OpenAPI 3.1** généré depuis les schémas Zod : `GET /api/v1/openapi.json`.
- Toutes les dates sont en ISO 8601 UTC (`2026-09-27T14:32:01.000Z`).
- Chaque réponse porte un en-tête `x-request-id`, repris dans les erreurs `INTERNAL_ERROR`.

## Authentification

Routes `/api/v1/requests*` : **serveur à serveur**, `Authorization: Bearer <clé API>`. Sans clé ou
avec une mauvaise clé : `401 { "error": "UNAUTHORIZED" }`. Aucun en-tête CORS n'est jamais émis.

Routes `/api/v1/dashboard/*` : cookie de session `tessera_session` posé par la passation. La clé
API n'y est **jamais** acceptée.

## Format des erreurs

```json
{ "error": "VALIDATION_ERROR", "details": [{ "path": "requester.id", "message": "Too small: …" }] }
```

L'App se base sur `error` (code stable) et n'affiche jamais le message brut.

| HTTP | `error`                   | Quand                                                         |
| ---- | ------------------------- | ------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`        | champ inconnu, type faux, longueur hors bornes, JSON invalide |
| 401  | `UNAUTHORIZED`            | clé API absente ou fausse ; session absente ou expirée        |
| 401  | `INVALID_HANDOFF`         | jeton de passation invalide, expiré, trop long ou rejoué      |
| 403  | `FORBIDDEN_ORIGIN`        | `POST` du tableau de bord sans l'en-tête `Origin` attendu     |
| 404  | `NOT_FOUND`               | identifiant inconnu (ou demande d'un autre utilisateur)       |
| 409  | `ALREADY_APPROVED`        | code déjà utilisé                                             |
| 409  | `CANCELLED`               | vérification d'une demande annulée                            |
| 409  | `NOT_CANCELLABLE`         | annulation d'une demande non `PENDING` (avec `status`)        |
| 409  | `IDEMPOTENCY_CONFLICT`    | même `Idempotency-Key` avec un autre corps                    |
| 410  | `EXPIRED`                 | échéance passée                                               |
| 413  | `PAYLOAD_TOO_LARGE`       | corps de plus de 16 Ko                                        |
| 415  | `UNSUPPORTED_MEDIA_TYPE`  | corps qui n'est pas du JSON                                   |
| 422  | `INVALID_CODE`            | mauvais code (avec `attemptsRemaining`)                       |
| 422  | `SELF_APPROVAL_FORBIDDEN` | `requester.id` égal à `approver.id`                           |
| 423  | `LOCKED`                  | plafond d'essais atteint                                      |
| 429  | `RATE_LIMITED`            | limite de débit dépassée                                      |
| 500  | `INTERNAL_ERROR`          | erreur interne, avec `requestId` ; jamais de détail           |

## `POST /api/v1/requests` — créer

En-tête optionnel : `Idempotency-Key` (1 à 128 caractères).

| Champ                          | Type                 | Règles                                                  |
| ------------------------------ | -------------------- | ------------------------------------------------------- |
| `requester`, `approver`        | `{ id, name }`       | `id` 1–128 caractères, `name` 1–200 ; ids différents    |
| `action`                       | string               | `^[A-Z0-9_.:-]{1,64}$`                                  |
| `displayText`                  | string               | 1–500 caractères, toujours affiché en texte brut        |
| `context`                      | objet JSON           | optionnel, ≤ 8 Ko sérialisé, jamais interprété          |
| `expiresInSeconds`             | entier               | optionnel ; `MIN_EXPIRES_IN_SECONDS`–`MAX_…` (60–86400) |
| `authorizationDurationSeconds` | entier ≥ 0 ou `null` | optionnel ; stocké et renvoyé tel quel                  |
| `maxAttempts`                  | entier               | optionnel, 1–10, défaut `DEFAULT_MAX_ATTEMPTS` (5)      |

`201` (création) ou `200` (rejeu idempotent, `code: null`) :

```json
{
  "id": "0b6f1c2e-5d1a-4c1e-9d65-7b0f8a2b9c11",
  "shortId": "8472-KQMX",
  "status": "PENDING",
  "code": "K7M4QX",
  "codeFormatted": "K7M-4QX",
  "expiresAt": "2026-09-27T14:42:01.000Z",
  "createdAt": "2026-09-27T14:32:01.000Z",
  "idempotentReplay": false
}
```

Erreurs : 400, 401, 409 `IDEMPOTENCY_CONFLICT`, 422 `SELF_APPROVAL_FORBIDDEN`, 429.

## `GET /api/v1/requests/:id` — consulter

Tous les champs sauf le code et son HMAC. Une demande `PENDING` échue est renvoyée `EXPIRED` et
cette transition est écrite (événement `EXPIRED`).

```json
{
  "id": "0b6f1c2e-5d1a-4c1e-9d65-7b0f8a2b9c11",
  "shortId": "8472-KQMX",
  "status": "PENDING",
  "requester": { "id": "42", "name": "Alice Martin" },
  "approver": { "id": "7", "name": "Bruno Keller" },
  "action": "CHANGE_PROJECT_PRIORITY",
  "displayText": "Alice demande de passer « Projet A » de la priorité 3 à la priorité 1",
  "context": { "projectId": "A", "oldPriority": 3, "newPriority": 1 },
  "authorizationDurationSeconds": 3600,
  "attempts": 1,
  "maxAttempts": 5,
  "attemptsRemaining": 4,
  "createdAt": "2026-09-27T14:32:01.000Z",
  "expiresAt": "2026-09-27T14:42:01.000Z",
  "approvedAt": null,
  "cancelledAt": null,
  "expiredAt": null,
  "lockedAt": null,
  "cancelReason": null
}
```

Erreurs : 401, 404.

## `POST /api/v1/requests/:id/verify` — vérifier

Corps : `{ "code": "k7m-4qx" }` (1–64 caractères ; majuscules, espaces et tirets normalisés).

Traitement atomique : la ligne est verrouillée (`SELECT … FOR UPDATE`), une demande échue passe en
`EXPIRED`, une demande non `PENDING` est refusée (événement `VERIFY_REJECTED`), le HMAC est comparé
à temps constant, un échec incrémente `attempts` (et verrouille au plafond), un succès approuve.

`200` :

```json
{
  "id": "0b6f1c2e-5d1a-4c1e-9d65-7b0f8a2b9c11",
  "status": "APPROVED",
  "approvedAt": "2026-09-27T14:33:18.000Z",
  "requester": { "id": "42", "name": "Alice Martin" },
  "approver": { "id": "7", "name": "Bruno Keller" },
  "action": "CHANGE_PROJECT_PRIORITY",
  "context": { "projectId": "A", "oldPriority": 3, "newPriority": 1 },
  "authorizationDurationSeconds": 3600
}
```

Erreurs : 400, 401, 404, 409 `ALREADY_APPROVED` / `CANCELLED`, 410 `EXPIRED`,
422 `INVALID_CODE` (`{ "error": "INVALID_CODE", "attemptsRemaining": 3 }`), 423 `LOCKED`, 429.

## `POST /api/v1/requests/:id/cancel` — annuler

Corps optionnel : `{ "reason": "…" }` (1–500 caractères). `200` avec la demande (même format que
`GET`). Déjà annulée : `200` sans nouvel événement. Autre état :
`409 { "error": "NOT_CANCELLABLE", "status": "APPROVED" }`.

## `GET /api/v1/requests/:id/events` — historique

```json
{
  "events": [
    {
      "id": "1",
      "type": "CREATED",
      "at": "2026-09-27T14:32:01.000Z",
      "meta": { "ip": "10.0.0.5" }
    },
    {
      "id": "2",
      "type": "VERIFY_FAILED",
      "at": "2026-09-27T14:32:40.000Z",
      "meta": { "ip": "10.0.0.5", "attemptsRemaining": 4 }
    },
    {
      "id": "3",
      "type": "APPROVED",
      "at": "2026-09-27T14:33:18.000Z",
      "meta": { "ip": "10.0.0.5" }
    }
  ],
  "chainValid": true
}
```

Types : `CREATED`, `VERIFY_FAILED`, `APPROVED`, `EXPIRED` (`meta.source` : `read`, `verify`,
`cancel` ou `sweep`), `CANCELLED` (`meta.reason`), `LOCKED` (`meta.attempts`), `VERIFY_REJECTED`
(`meta.status`). `meta` ne contient jamais le code ni la clé API.

## Santé

- `GET /livez` : `200 { "status": "ok" }` tant que le processus tourne.
- `GET /health` : `200 { "status": "ok" }` si PostgreSQL répond, sinon `503 { "status": "unavailable" }`.

## Tableau de bord (session cookie)

| Route                                | Rôle                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `POST /api/v1/dashboard/handoff`     | `{ token }` → pose le cookie `tessera_session`, renvoie `{ id, name }` |
| `POST /api/v1/dashboard/logout`      | efface le cookie (`204`)                                               |
| `GET /api/v1/dashboard/me`           | `{ id, name, hasRequested, hasToApprove }`                             |
| `GET /api/v1/dashboard/requests`     | liste paginée (25), voir ci-dessous                                    |
| `GET /api/v1/dashboard/requests/:id` | `{ request, events, chainValid }` ; `404` si je n'y participe pas      |

Paramètres de la liste : `role=requester|approver` (obligatoire), `status`, `action`, `from`, `to`
(ISO 8601, sur la date de création), `counterpart` (identifiant exact ou partie du nom de l'autre
personne), `cursor` (valeur `nextCursor` de la page précédente). Réponse :
`{ "items": [ …demandes… ], "nextCursor": "…" | null }`. Le filtre « je suis demandeur / approbateur »
est appliqué dans la requête SQL.

Les `POST` du tableau de bord exigent `Origin` égal à `PUBLIC_URL` ; le cookie est `HttpOnly`,
`SameSite=Strict`, `Secure` (hors développement).
