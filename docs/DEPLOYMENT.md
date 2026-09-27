# Déploiement

Une instance de Tessera sert **une** App : déployez une instance (et une base) par App.

## Image

```sh
make build   # docker build --target runtime -t tessera:latest .
make smoke   # vérifie : utilisateur non root, migrations, HEALTHCHECK, /health
```

L'image finale (Node 22 slim) contient le backend compilé, le tableau de bord construit et les
seules dépendances de production. Elle tourne en utilisateur `node` (non root), expose le port
3000, définit un `HEALTHCHECK` sur `/livez` et ne contient aucun secret. Point d'entrée :
`node backend/dist/main.js`, avec deux commandes :

- `serve` (par défaut) : l'API, le tableau de bord et les tâches périodiques ;
- `migrate` : applique les migrations puis s'arrête ; code de sortie 1 en cas d'échec.

## Compose de production

[`docker-compose.prod.yml`](../docker-compose.prod.yml) est un exemple : PostgreSQL 16, un service
`migrate` qui doit réussir avant le démarrage de `tessera`, `restart: unless-stopped`, et chaque
secret exigé par `${VAR:?}`.

```sh
export POSTGRES_PASSWORD=… API_KEYS=… CODE_HMAC_KEY=… HANDOFF_SECRET=… SESSION_SECRET=…
export PUBLIC_URL=https://tessera.example.com TRUST_PROXY=172.18.0.0/16
docker compose -f docker-compose.prod.yml up -d
```

Générez chaque secret séparément, par exemple avec `openssl rand -base64 48`. Ils doivent tous être
différents : Tessera refuse de démarrer sinon.

## Reverse proxy TLS

Tessera ne termine pas TLS. Placez-le derrière un reverse proxy (Caddy, Nginx, Traefik…) et :

- publiez Tessera uniquement pour le proxy (l'exemple lie le port à `127.0.0.1`) ;
- réglez `TRUST_PROXY` sur l'adresse ou le réseau du proxy (jamais `true` si Tessera est joignable
  autrement que par lui), pour que les IP des événements et des limites de débit soient justes ;
- réglez `PUBLIC_URL` sur l'origine HTTPS publique : elle sert au contrôle `Origin` du tableau de
  bord et doit correspondre à l'URL vers laquelle l'App redirige.

Exemple Caddy :

```
tessera.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

En `production`, HSTS est envoyé et le cookie de session est toujours `Secure`.

Les routes `/api/v1/requests*` sont appelées par le serveur de l'App : vous pouvez les restreindre
au réseau de l'App au niveau du proxy. Le tableau de bord (`/`, `/assets/*`, `/api/v1/dashboard/*`)
doit rester joignable par les navigateurs.

## Migrations

Les migrations Kysely sont versionnées et intégrées à l'image. Lancez `migrate` avant chaque
démarrage d'une nouvelle version (le compose de production le fait). Elles sont idempotentes et un
verrou empêche deux exécutions simultanées.

## Plusieurs instances

Possible derrière un répartiteur : la session est sans état, et les tâches (expiration périodique,
purge quotidienne) prennent un verrou consultatif PostgreSQL (`pg_try_advisory_lock`) pour qu'une
seule instance les exécute à la fois. Les limites de débit sont par instance (voir
[DECISIONS.md](DECISIONS.md)).

## Rotation des clés et des secrets

- **Clés API** (sans coupure) : ajoutez la nouvelle clé (`API_KEYS=ancienne,nouvelle`),
  redéployez, basculez l'App sur la nouvelle clé, puis retirez l'ancienne et redéployez.
- **`HANDOFF_SECRET`** : changez-le en même temps côté App et côté Tessera ; seuls les jetons de
  passation en vol (60 s au plus) sont perdus.
- **`SESSION_SECRET`** : les sessions ouvertes sont invalidées ; les utilisateurs rouvrent le
  tableau de bord depuis l'App.
- **`CODE_HMAC_KEY`** : les codes des demandes `PENDING` deviennent invalides. Faites-le quand
  aucune demande n'est en attente, ou acceptez que les demandes en cours soient recréées.

## Sauvegardes de PostgreSQL

```sh
# Sauvegarde
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U tessera -d tessera --format=custom > tessera-$(date +%F).dump

# Restauration (base vide)
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U tessera -d tessera --clean --if-exists < tessera-2026-09-27.dump
```

La base ne contient aucun code en clair, mais elle contient les noms, les textes et les contextes
fournis par l'App : chiffrez et protégez les sauvegardes. La purge (`RETENTION_DAYS`) ne s'applique
pas aux sauvegardes : alignez leur durée de conservation.

## Journaux

Les journaux sont en JSON sur la sortie standard (pino). Chaque réponse porte `x-request-id`, que
l'on retrouve dans les journaux (`reqId`) pour enquêter sur une erreur `INTERNAL_ERROR`.
