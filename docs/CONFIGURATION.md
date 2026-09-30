# Configuration

Toute la configuration est lue depuis l'environnement et validée par Zod dans un seul module
(`backend/src/config.ts`) au démarrage. Une valeur invalide empêche le démarrage avec un message qui
nomme la variable, sans jamais afficher sa valeur. **Aucun secret n'a de valeur par défaut.**

En développement, `make up` crée `.env` depuis [`.env.example`](../.env.example) en générant des
secrets aléatoires. `.env` est ignoré par git.

## Variables obligatoires

| Variable         | Rôle                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`       | `development`, `test`, `staging` ou `production`. Toute autre valeur est refusée.       |
| `DATABASE_URL`   | `postgres://utilisateur:mot-de-passe@hôte:port/base`                                    |
| `API_KEYS`       | clés API séparées par des virgules, 32 caractères au moins chacune                      |
| `CODE_HMAC_KEY`  | clé du HMAC des codes (≥ 32 caractères)                                                 |
| `HANDOFF_SECRET` | secret HS256 partagé avec le serveur de l'App pour la passation (≥ 32 caractères)       |
| `SESSION_SECRET` | signe le cookie de session du tableau de bord (≥ 32 caractères)                         |
| `PUBLIC_URL`     | origine publique de Tessera (`https://tessera.example.com`) ; sert au contrôle `Origin` |
| `TRUST_PROXY`    | `false`, `true`, ou liste d'IP/CIDR des proxys de confiance (`10.0.0.0/8,127.0.0.1`)    |

Règles sur les secrets (`API_KEYS`, `CODE_HMAC_KEY`, `HANDOFF_SECRET`, `SESSION_SECRET`), dans
tous les environnements : 32 caractères au moins, et tous différents les uns des autres. En
`staging` et `production`, une valeur contenant `CHANGE_ME` (valeur d'exemple) est refusée.

## Variables optionnelles

- `EMBED_ORIGINS` : origines autorisées à afficher le tableau de bord dans un `<iframe>` (directive
  `frame-ancestors`), séparées par des espaces, par exemple `https://console.orqea.dev http://localhost:3002`.
  Vide ou absente : `'none'`. Origines `http(s)` nues seulement (pas de joker, de chemin ni d'autre schéma :
  démarrage refusé). Ne concerne que les pages du tableau de bord, jamais l'API.
- `TESSERA_ORQEA_URL` : cible du lien « Revenir sur Orqea » (`https://orqea.dev` par défaut) ; masqué dans un `<iframe>`.

| Variable                        | Défaut    | Bornes           | Rôle                                                         |
| ------------------------------- | --------- | ---------------- | ------------------------------------------------------------ |
| `PORT`                          | `3000`    | 0–65535          | port d'écoute                                                |
| `HOST`                          | `0.0.0.0` |                  | interface d'écoute                                           |
| `CODE_LENGTH`                   | `6`       | 6–12             | longueur des codes                                           |
| `DEFAULT_EXPIRES_IN_SECONDS`    | `600`     | entre MIN et MAX | durée de validité si `expiresInSeconds` est omis             |
| `MIN_EXPIRES_IN_SECONDS`        | `60`      | ≥ 1              | borne basse de `expiresInSeconds`                            |
| `MAX_EXPIRES_IN_SECONDS`        | `86400`   | ≤ 2 592 000      | borne haute de `expiresInSeconds`                            |
| `DEFAULT_MAX_ATTEMPTS`          | `5`       | 1–10             | essais si `maxAttempts` est omis                             |
| `SESSION_TTL_SECONDS`           | `3600`    | 60–86400         | durée de la session du tableau de bord                       |
| `RETENTION_DAYS`                | `365`     | 1–3650           | conservation des demandes terminées avant purge              |
| `EXPIRY_SWEEP_INTERVAL_SECONDS` | `60`      | 1–3600           | période de la tâche d'expiration                             |
| `RATE_LIMIT_WINDOW_SECONDS`     | `60`      | 1–3600           | fenêtre de toutes les limites de débit                       |
| `RATE_LIMIT_API_MAX`            | `600`     | ≥ 1              | appels API par clé et par fenêtre                            |
| `RATE_LIMIT_VERIFY_IP_MAX`      | `30`      | ≥ 1              | `verify` par IP et par fenêtre                               |
| `RATE_LIMIT_VERIFY_REQUEST_MAX` | `10`      | ≥ 1              | `verify` par demande et par fenêtre                          |
| `RATE_LIMIT_HANDOFF_IP_MAX`     | `10`      | ≥ 1              | passations par IP et par fenêtre                             |
| `LOG_LEVEL`                     | `info`    | niveaux pino     | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

## Selon l'environnement

| Variable      | `development` (`make up`)         | `test` (suites)            | `staging` / `production`              |
| ------------- | --------------------------------- | -------------------------- | ------------------------------------- |
| secrets       | générés dans `.env` par `make up` | générés à chaque lancement | gestionnaire de secrets, obligatoires |
| `PUBLIC_URL`  | `http://localhost:3000`           | `http://tessera.test`      | URL HTTPS publique                    |
| `TRUST_PROXY` | `false`                           | `false`                    | IP/CIDR du reverse proxy TLS          |
| cookie        | sans `Secure`                     | `Secure`                   | `Secure`                              |
| HSTS          | non                               | non                        | `production` uniquement               |

## Variables propres à la pile de développement

`docker-compose.yml` lit aussi dans `.env` : `POSTGRES_PASSWORD` (base locale), `DEMO_API_KEY`
(une des `API_KEYS`, utilisée par l'App de démonstration) et, optionnellement, `TESSERA_PORT`,
`DEMO_PORT`, `POSTGRES_PORT` pour changer les ports publiés sur `127.0.0.1`.
