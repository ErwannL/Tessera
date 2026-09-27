# Décisions

Choix faits là où le cahier des charges laissait de la latitude. Principe appliqué : l'option la
plus simple et la plus sûre.

## Données

1. **`request_fingerprint` (bytea, non nul)** ajouté à `requests` : SHA-256 du corps de création
   canonique (valeurs par défaut appliquées). Il permet de distinguer, pour une même
   `Idempotency-Key`, un rejeu (même corps) d'un conflit (corps différent) sans comparer champ par
   champ.
2. **`short_id` au format `NNNN-LLLL`** (4 chiffres, 4 lettres sans `I L O`), aléatoire. L'exemple
   du cahier (`8472-KQ`) laissait trop peu de combinaisons pour éviter les collisions ; en cas de
   collision (contrainte unique), la création réessaie jusqu'à 5 fois.
3. **`expired_at` = l'échéance** (`expires_at`), pas l'instant où l'expiration a été constatée ;
   l'événement `EXPIRED` porte l'instant de la transition et sa source (`read`, `verify`, `cancel`,
   `sweep`).
4. **Chaîne de hash** : SHA-256 de `prev_hash (hex, vide pour le premier) ⏎ request_id ⏎ type ⏎ at
(ISO 8601 ms) ⏎ meta (JSON canonique, clés triées)`. Le séparateur évite toute ambiguïté.
5. **HMAC du code** sur `"<request_id>:<code normalisé>"`, comme demandé.
6. **Trigger d'historique** : `UPDATE` toujours refusé ; `DELETE` accepté seulement quand
   `pg_trigger_depth() > 1`, c'est-à-dire depuis la cascade `ON DELETE CASCADE` de la purge.
7. **Purge** : une demande terminée est datée par `coalesce(approved_at, cancelled_at,
expired_at, locked_at)`.
8. **Migrations intégrées statiquement** au code (pas de lecture de dossier) pour que l'image
   compilée n'ait pas de dépendance au système de fichiers.

## API

9. **Rejeu idempotent en `200`** (et non `201`) : rien n'a été créé ; `code: null`,
   `idempotentReplay: true`.
10. **Annulation d'une demande non `PENDING` : `409 NOT_CANCELLABLE`** avec `status` (l'« état
    actuel » demandé). Une demande `PENDING` échue est d'abord passée en `EXPIRED`.
11. **Identifiant mal formé (pas un UUID) : `404 NOT_FOUND`**, comme un identifiant inconnu.
12. **Codes d'erreur ajoutés** : `NOT_CANCELLABLE`, `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`,
    `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `INVALID_HANDOFF`, `FORBIDDEN_ORIGIN`.
13. **`GET /requests/:id` verrouille la ligne** (`FOR UPDATE`) pour appliquer l'expiration
    paresseuse sans course ni double événement. Coût négligeable pour cet usage.
14. **Le tableau de bord applique aussi l'expiration paresseuse** aux demandes de l'utilisateur
    avant de lister ou d'afficher, pour ne jamais montrer « En attente » une demande échue.
15. **`authorizationDurationSeconds`** : entier ≥ 0 ou `null`, non interprété.
16. **Filtre « personne »** : identifiant exact de l'autre personne, ou partie de son nom
    (insensible à la casse, jokers `%` et `_` échappés).
17. **OpenAPI public** (`/api/v1/openapi.json` sans clé) : il ne contient aucun secret et aide
    l'intégration.
18. **En-tête `x-request-id`** sur chaque réponse, identique au `requestId` des erreurs 500 et au
    `reqId` des journaux.

## Sécurité

19. **Pas de plugin CORS** : aucune réponse n'émet d'en-tête `Access-Control-Allow-*`, donc aucun
    navigateur tiers ne peut lire l'API ; le tableau de bord est servi par la même origine. Les
    `POST` du tableau de bord vérifient en plus `Origin === PUBLIC_URL`.
20. **Longueur (≥ 32) et unicité des secrets vérifiées dans tous les environnements**, pas
    seulement en `staging`/`production` : plus simple et plus sûr. En `staging`/`production`, une
    valeur contenant `CHANGE_ME` est aussi refusée.
21. **`TRUST_PROXY` obligatoire** (explicite) : `false`, `true` ou liste d'IP/CIDR. Le nombre de
    sauts n'est pas proposé (les types de Fastify ne l'acceptent pas et une liste est plus sûre).
22. **HSTS en `production` seulement** ; le cookie est `Secure` partout sauf en `development`.
23. **Jetons** : passation et session sont des JWT HS256 vérifiés avec `jose` (bibliothèque
    éprouvée plutôt qu'une implémentation maison). Passation : `jti` de 16 caractères au moins,
    tolérance d'horloge de 5 s, âge maximal 60 s depuis `iat`. Session : audience
    `tessera-session`, sans état côté serveur.
24. **Limites de débit en mémoire, par instance** (`@fastify/rate-limit`, store local), appliquées
    par un hook qui combine plusieurs limites indépendantes (le plugin n'en applique qu'une par
    requête) : par clé API, `verify` par IP **et** par demande, passation par IP. Avec plusieurs
    instances, un store partagé (Redis) serait à ajouter ; le plafond d'essais par demande reste
    global car il est en base.
25. **Erreurs journalisées sans leur `detail`** : le pilote PostgreSQL peut y recopier une ligne
    (texte, contexte).
26. **Pool PostgreSQL** : un écouteur d'erreur évite qu'une connexion inactive coupée par le
    serveur (redémarrage) fasse tomber le processus ; la requête suivante se reconnecte.

## Tâches

27. **Arrêt propre** : `SIGTERM`/`SIGINT` arrêtent les minuteries, attendent la fin de la tâche en
    cours, ferment le serveur puis le pool.
28. **La purge tourne au démarrage puis toutes les 24 h** ; l'expiration toutes les
    `EXPIRY_SWEEP_INTERVAL_SECONDS`, par lots de 500 (`FOR UPDATE SKIP LOCKED`).

## Frontend

29. **Pas de routeur** : le détail s'ouvre dans le panneau de l'onglet (bouton « Retour »). Le
    fragment d'URL est réservé à la passation.
30. **Langue** : français si la première langue du navigateur est le français, anglais sinon.
31. **Un bouton « Se déconnecter »** est proposé ; ce n'est pas une action sur les demandes.
32. **CSS simple** (une feuille globale et des variables CSS), pas de CSS modules : l'interface
    est petite et cohérente.

## Outillage

33. **Développement** : le backend redémarre via `tsx watch` ; le tableau de bord est reconstruit
    par `vite build --watch` (actualiser la page) plutôt que servi par le serveur de dev Vite, qui
    injecte des scripts en ligne incompatibles avec la CSP stricte. La CSP est ainsi identique
    partout.
34. **`make up` génère `.env`** (`scripts/init-env.sh`) avec des secrets aléatoires quand il
    n'existe pas : aucun secret par défaut, et démarrage en une commande.
35. **App de démonstration sans dépendance** : TypeScript exécuté directement par Node 22
    (suppression des types), état en mémoire.
36. **e2e** : l'App de démo et Playwright partagent l'espace réseau du conteneur Tessera, pour que
    le navigateur voie `http://localhost:3000` et `http://localhost:4000` comme un développeur (et
    accepte le cookie `Secure` sur `localhost`). `MIN_EXPIRES_IN_SECONDS=5` y permet de tester
    l'expiration sans attendre une minute.
37. **`PLAYWRIGHT_CHROMIUM_EXECUTABLE`** (optionnel) permet de lancer la suite e2e avec un
    Chromium déjà installé, hors de l'image Playwright.
