# TESSERA

> Une action nécessite l'accord de quelqu'un d'autre ? Demandez-lui sa tessera.

Dans l'Antiquité, la _tessera hospitalis_ était un jeton brisé en deux et partagé entre deux
personnes : rapprocher les deux moitiés attestait l'accord qui les liait. Tessera fait la même
chose avec un code à usage unique que **B** confie à **A**.

Tessera est une **brique d'autorisation entre deux personnes** que votre application (« l'App »)
branche à côté d'elle. Une personne **A** (le _demandeur_) veut faire une action qui exige l'accord
d'une personne **B** (l'_approbateur_). Tessera crée une demande et génère un code. B reçoit ce
code par l'App, le donne à A, A le saisit : Tessera confirme que **cette** demande est approuvée,
et l'App peut exécuter l'action.

## Le déroulé

```
   A (demandeur)            Serveur de l'App                 Tessera                B (approbateur)
        │  « Demander l'accord  │                                │                          │
        │     de B »            │                                │                          │
        │──────────────────────▶│  POST /api/v1/requests         │                          │
        │                       │───────────────────────────────▶│ crée la demande,         │
        │                       │   { id, code, expiresAt }      │ génère le code           │
        │                       │◀───────────────────────────────│ (renvoyé UNE fois)       │
        │                       │  envoie le code à B par SES propres moyens (email, SMS…)  │
        │                       │──────────────────────────────────────────────────────────▶│
        │           B donne le code à A (oralement, par message…) : hors du système         │
        │◀──────────────────────────────────────────────────────────────────────────────────│
        │  saisit le code       │                                │                          │
        │──────────────────────▶│  POST /requests/:id/verify     │                          │
        │                       │───────────────────────────────▶│ vérifie (atomique)       │
        │                       │   APPROVED + ce qui est        │                          │
        │                       │◀── approuvé (action, contexte)─│                          │
        │   l'App exécute       │                                │                          │
        │◀──────────────────────│                                │                          │
```

### Ce que Tessera fait

- créer des demandes d'autorisation et générer un code temporaire à usage unique lié à **une**
  demande précise ;
- vérifier ce code, de façon atomique (une seule réussite, même sous concurrence) ;
- gérer l'expiration, l'annulation et le verrouillage après trop d'essais ;
- garder un historique chaîné par hash de chaque demande (toute altération est détectable) ;
- proposer un tableau de bord **en lecture seule** (« Mes demandes » / « À approuver »).

### Ce que Tessera ne fait jamais

- envoyer des emails, SMS, notifications ou appels : c'est l'App qui transmet le code ;
- authentifier les utilisateurs : pas de mot de passe, pas d'inscription ;
- connaître le métier de l'App, ni exécuter l'action demandée ;
- interpréter la durée d'autorisation : elle est stockée et renvoyée telle quelle.

Tessera fournit une **trace technique de validation** : une demande a été créée pour telle
personne, un code unique a été généré, il a été saisi correctement à telle date et la demande a été
approuvée. La transmission du code de B à A se fait hors du système.

## Démarrer (Docker uniquement)

```sh
make up PROFILE=demo      # génère .env avec des secrets aléatoires, lance Tessera + PostgreSQL + l'App de démo
open http://localhost:4000 # l'App de démo : ouvrez « Alice » et « Bruno » côte à côte
make down                  # arrête tout
```

Le tableau de bord est sur <http://localhost:3000> (il s'ouvre depuis l'App, bouton « Ouvrir mon
tableau de bord Tessera »). Sans le profil de démo, `make up` lance Tessera et PostgreSQL seuls.

| Commande        | Rôle                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `make up`       | pile de développement (rechargement à chaud), `PROFILE=demo` pour l'App |
| `make down`     | arrête la pile                                                          |
| `make logs`     | suit les journaux                                                       |
| `make test`     | tous les tests (backend et frontend), dans Docker                       |
| `make coverage` | tests avec couverture ; échoue sous 100 % pour n'importe quel fichier   |
| `make lint`     | ESLint, Prettier et `tsc --noEmit`                                      |
| `make e2e`      | Playwright sur une pile Docker complète et jetable                      |
| `make build`    | image de production                                                     |
| `make smoke`    | image de production : non-root, migrations, `/health`                   |

Chaque commande existe aussi en script npm (`npm run up`, `npm run test`, `npm run e2e`…).

## Documentation

- [Intégrer Tessera dans une App](docs/INTEGRATION.md) (curl et Node.js)
- [Référence de l'API](docs/API.md) — OpenAPI 3.1 servi en `/api/v1/openapi.json`
- [Sécurité et modèle de menace](docs/SECURITY.md)
- [Configuration](docs/CONFIGURATION.md)
- [Déploiement](docs/DEPLOYMENT.md)
- [Tests et couverture](docs/TESTING.md)
- [Décisions d'architecture](docs/DECISIONS.md)

## Structure

```
backend/            API Fastify, Kysely/PostgreSQL, tâches périodiques (Node 22, TypeScript)
frontend/           tableau de bord React en lecture seule, servi par le backend
examples/demo-app/  App de démonstration : intégration de référence
e2e/                scénario Playwright complet
docs/               documentation
```
