# Tests

## Commandes

Tout passe par Docker ; seul Docker est requis.

| Commande        | Ce qu'elle fait                                                                              |
| --------------- | -------------------------------------------------------------------------------------------- |
| `make test`     | tests backend et frontend dans l'image outillée, avec une PostgreSQL de test jetable (tmpfs) |
| `make coverage` | les mêmes tests avec mesure de couverture ; échoue sous 100 % pour n'importe quel fichier    |
| `make lint`     | `eslint . --max-warnings=0`, `prettier --check .`, `tsc --noEmit` dans chaque paquet         |
| `make e2e`      | construit l'image de production, lance PostgreSQL + Tessera + l'App de démo, joue Playwright |
| `make smoke`    | image de production : utilisateur non root, migrations, `HEALTHCHECK`, `/health`             |

Les conteneurs et volumes de test sont supprimés à la fin, même en cas d'échec
(`docker compose … down -v` dans un `trap`). Les secrets de test sont générés à chaque lancement.

Hors Docker (pour itérer vite), avec une PostgreSQL jetable :
`TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm run coverage:all`.

## Seuils

Backend (`backend/vitest.config.ts`) et frontend (`frontend/vite.config.ts`) :

```ts
coverage: {
  provider: 'v8',
  thresholds: { statements: 100, branches: 100, functions: 100, lines: 100, perFile: true },
}
```

La mesure couvre tout `src/`. Aucun commentaire `istanbul`/`c8`/`v8 ignore`, aucun `.skip`,
`.only` ou `.todo` (une règle ESLint les interdit dans le code commité).

## Exclusions (et pourquoi)

| Fichier                        | Raison                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/src/main.ts`          | point d'entrée réduit à un appel : `await main(process)`. `main` est testé dans `test/integration/cli.test.ts`.                                                                                                                     |
| `backend/src/db/migrations/**` | migrations : testées séparément par application réelle sur une base vide (`test/integration/migrations.test.ts` : application, idempotence, `down`, échec propre) et par les tests de contraintes et de trigger (`schema.test.ts`). |
| `frontend/src/main.tsx`        | point d'entrée réduit à un appel : `void mount(window)`. `mount` est testé dans `test/bootstrap.test.tsx`.                                                                                                                          |

Les fichiers de types purs (`*.d.ts`) seraient exclus ; il n'y en a pas.

## Base de données de test

Chaque fichier de test crée sa propre base (`CREATE DATABASE tessera_t_<aléatoire>`), y applique
les migrations, puis la supprime. Les fichiers s'exécutent en parallèle sans interférer. Le temps
est injecté (`FakeClock`) : aucun test n'attend réellement une expiration.

## Scénarios obligatoires

| #   | Scénario                                                                                               | Où                                                      |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| 1   | création : champs, état, événement `CREATED`, code renvoyé une fois                                    | `api-create.test.ts`                                    |
| 2   | alphabet et longueur du code ; HMAC stocké ≠ code                                                      | `unit/code.test.ts`, `api-create.test.ts`               |
| 3   | validation correcte, `APPROVED` avec le contexte                                                       | `api-verify.test.ts`                                    |
| 4   | mauvais code, `attemptsRemaining` décrémenté                                                           | `api-verify.test.ts`                                    |
| 5   | code expiré, y compris encore `PENDING` en base                                                        | `api-verify.test.ts`                                    |
| 6   | code déjà utilisé : `ALREADY_APPROVED`                                                                 | `api-verify.test.ts`                                    |
| 7   | trop d'essais : `LOCKED`, bon code refusé ensuite                                                      | `api-verify.test.ts`                                    |
| 8   | annulation, vérification refusée, annulation idempotente                                               | `api-cancel.test.ts`, `api-verify.test.ts`              |
| 9   | auto-approbation refusée                                                                               | `api-create.test.ts`, `schema.test.ts` (contrainte SQL) |
| 10  | demandes croisées A, B, C : chaque code ne valide que sa demande                                       | `api-verify.test.ts`                                    |
| 11  | inversion des rôles                                                                                    | `api-verify.test.ts`                                    |
| 12  | même code tiré pour deux demandes (générateur injecté)                                                 | `api-verify.test.ts`                                    |
| 13  | 20 `verify` simultanés : 1 succès, 19 `ALREADY_APPROVED` ; 20 mauvais : jamais plus que `max_attempts` | `api-verify.test.ts`                                    |
| 14  | idempotence de création (même clé, corps différent, concurrence)                                       | `api-create.test.ts`                                    |
| 15  | authentification API : sans clé, mauvaise clé, rotation                                                | `api-security.test.ts`, `unit/misc.test.ts`             |
| 16  | validation de chaque champ, champ inconnu, `context` trop gros                                         | `api-security.test.ts`                                  |
| 17  | historique : ordre, chaîne valide, altération détectée, `UPDATE` refusé                                | `schema.test.ts`, `unit/hashChain.test.ts`              |
| 18  | expiration par la tâche et par la lecture, sans double événement                                       | `jobs.test.ts`, `api-cancel.test.ts`                    |
| 19  | purge à `RETENTION_DAYS`                                                                               | `jobs.test.ts`                                          |
| 20  | passation : valide, signature, `aud`, expiré, durée > 60 s, `jti` rejoué, cookie                       | `handoff.test.ts`                                       |
| 21  | tableau de bord : périmètre, `404` sur la demande d'un autre, filtres, pagination                      | `dashboard.test.ts`                                     |
| 22  | configuration : variables manquantes/invalides, secrets égaux, aucune valeur dans le message           | `unit/config.test.ts`, `cli.test.ts`                    |
| 23  | `/health` 503 puis 200                                                                                 | `platform.test.ts`                                      |
| 24  | limites de débit sur `verify` (demande et IP) et `handoff`                                             | `platform.test.ts`, `handoff.test.ts`                   |
| 25  | aucun code, clé ni secret dans les journaux d'un parcours complet                                      | `platform.test.ts`                                      |
| 26  | les réponses 500 n'exposent rien                                                                       | `api-security.test.ts`                                  |

Tous les fichiers backend sont dans `backend/test/` (`integration/` sur une vraie PostgreSQL,
`unit/` pour la logique pure).

Frontend (`frontend/test/`) : règle des onglets (deux, un seul, aucun), lignes dans chaque état,
compte à rebours sur horloge simulée, détail, historique, indicateur d'intégrité, filtres,
pagination, passation (fragment lu **puis effacé** avant tout appel réseau), erreur de passation,
session absente, `displayText` contenant `<script>` rendu comme du texte, clés fr/en identiques et
non vides.

e2e (`e2e/tests/flow.spec.ts`) : A crée une demande, B voit le code, A saisit un mauvais code puis
le bon, A et B ouvrent leur tableau de bord et voient les bons onglets, annulation et expiration
visibles, aucune erreur dans la console du navigateur.

## Des tests qui peuvent échouer

Chaque garde de sécurité a un test qui casse si on la retire : contrôle `aud`, durée de passation
(`exp - iat > 60`), `jti` rejoué, contrôle `Origin`, filtre SQL du périmètre (un utilisateur ne
voit jamais les demandes d'un autre), échappement des jokers `%`/`_` du filtre « personne »,
`FOR UPDATE` (tests de concurrence), trigger d'historique, masquage des journaux.
