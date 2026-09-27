# Sécurité

## Ce que Tessera atteste

Tessera fournit une **trace technique de validation** : une demande a été créée pour telle
personne, un code unique a été généré pour **cette** demande, ce code a été saisi correctement à
telle date, et la demande a été approuvée. Tessera ne peut pas attester que B a lui-même transmis
le code à A : cette transmission se passe hors du système, et c'est l'App qui a remis le code à B.

## Modèle de menace et mesures

| Menace                                  | Mesures                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Force brute sur un code                 | 31 symboles, 6 caractères par défaut (≈ 8,9 × 10⁸ combinaisons) ; plafond d'essais par demande (5 par défaut, 10 au plus) puis `LOCKED` ; limites de débit sur `verify` par demande **et** par IP ; expiration courte (10 min par défaut).                                                                                       |
| Rejeu d'un code                         | un code ne sert qu'une fois (`ALREADY_APPROVED`) ; le code est lié à l'identifiant de la demande (HMAC sur `id:code`), il ne valide jamais une autre demande.                                                                                                                                                                    |
| Concurrence (double validation)         | `verify` et `cancel` tournent dans une transaction avec `SELECT … FOR UPDATE` : N vérifications simultanées donnent exactement un succès ; les échecs simultanés ne dépassent jamais `max_attempts` (testé).                                                                                                                     |
| Fuite de la base                        | le code n'est jamais stocké : seul `HMAC-SHA256(CODE_HMAC_KEY, id ":" code)` l'est ; sans la clé, la base ne permet pas de retrouver ni de vérifier un code.                                                                                                                                                                     |
| Vol de clé API                          | clés d'au moins 32 caractères, seules leurs empreintes SHA-256 restent en mémoire, comparaison à temps constant ; rotation sans coupure (`API_KEYS` accepte plusieurs clés) ; limite de débit par clé contre un script qui s'emballe.                                                                                            |
| Jeton de passation intercepté ou rejoué | JWT HS256 signé par le serveur de l'App, `aud` vérifié, durée de vie ≤ 60 s (`exp - iat`), `jti` à usage unique (clé primaire en base), transporté dans le fragment d'URL (jamais envoyé aux serveurs ni au `Referer`) et effacé au chargement.                                                                                  |
| Vol de session / CSRF                   | cookie `HttpOnly`, `Secure` (hors développement), `SameSite=Strict`, signé, durée limitée ; vérification de l'en-tête `Origin` sur les `POST` ; aucune action d'écriture dans le tableau de bord.                                                                                                                                |
| Accès aux demandes d'autrui             | le filtre « demandeur = moi ou approbateur = moi » est dans la requête SQL ; une demande d'un autre renvoie `404` (pas `403`).                                                                                                                                                                                                   |
| XSS par `displayText` ou `context`      | aucun rendu HTML des données de l'App (React échappe tout, aucun `dangerouslySetInnerHTML`) ; CSP stricte sans `unsafe-inline` ni `unsafe-eval`, `frame-ancestors 'none'`.                                                                                                                                                       |
| Injection SQL                           | uniquement des requêtes Kysely paramétrées.                                                                                                                                                                                                                                                                                      |
| Fuite par les journaux                  | journaux JSON (pino) : identifiants, types d'événements, durées. Jamais de code, clé, secret, jeton, `context` ni `displayText` ; en-têtes `authorization` et `cookie` masqués ; erreurs sérialisées sans leur `detail` (qui peut contenir une ligne). Un test parcourt un scénario complet et vérifie l'absence de ces valeurs. |
| Fuite par les erreurs                   | les réponses 500 sont toujours `{ "error": "INTERNAL_ERROR", "requestId": "…" }`.                                                                                                                                                                                                                                                |
| Altération de l'historique              | `request_events` en ajout seul : un trigger refuse `UPDATE` et tout `DELETE` hors cascade de purge ; chaque événement est chaîné (SHA-256 du précédent), `chainValid` signale toute modification ou suppression.                                                                                                                 |
| Mauvaise configuration                  | configuration validée au démarrage ; aucun secret par défaut ; en `staging`/`production`, un secret absent, court, réutilisé ou laissé à sa valeur d'exemple empêche le démarrage (le message nomme la variable, jamais la valeur).                                                                                              |
| Conteneur                               | image minimale, utilisateur non root, aucun secret dans l'image.                                                                                                                                                                                                                                                                 |

## Limites assumées

- **La transmission du code est hors système.** Tessera ne sait pas comment B a donné le code à
  A. Si B transmet son code à la mauvaise personne, ou si le canal utilisé par l'App pour joindre B
  est compromis, Tessera ne peut pas le détecter.
- **L'App voit le code en clair** (réponse de création) : elle doit le garder côté serveur, ne le
  transmettre qu'à B, et ne jamais l'afficher à A ni le journaliser.
- **L'App doit vérifier ce qui a été approuvé** (`action`, `context`, `requester.id`) avant
  d'exécuter l'action : Tessera n'exécute rien.
- **Limites de débit en mémoire** : chaque instance a ses propres compteurs. Avec plusieurs
  instances, la limite effective est multipliée par le nombre d'instances ; le plafond d'essais par
  demande, lui, est global (en base).
- **Horloge** : l'expiration dépend de l'horloge du serveur Tessera ; la passation tolère 5 s de
  décalage avec le serveur de l'App.
- **HTTPS** : Tessera doit tourner derrière un reverse proxy TLS ; `TRUST_PROXY` doit refléter
  exactement ce proxy pour que les IP (limites de débit, événements) soient justes.

## Signaler une vulnérabilité

Merci d'écrire aux mainteneurs du dépôt en privé plutôt que d'ouvrir un ticket public.
