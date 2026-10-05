# Sécurité, RGPD et données de santé

Document de travail pour le DPO, la DSI et l'hébergeur HDS. Les points réglementaires sont à valider par
le DPO de la FFSA.

## Mesures intégrées à l'application

| Domaine | Mesure |
|---|---|
| Chiffrement | Formulaires, rapports médicaux, pièces jointes, notes internes, coordonnées des médecins et secrets 2FA chiffrés en AES-256-GCM au niveau applicatif. Trousseau de clés avec rotation (`npm run rotate-key`) ; clé lisible depuis un fichier fourni par le coffre de secrets (`DATA_ENCRYPTION_KEY_FILE`). |
| Habilitations | **Service médical** : seul rôle ayant accès aux données de santé (dossiers, rapports, PDF, exports). **Administrateur** : comptes, demandes d'accès, journal — aucun accès aux dossiers. **Organisateur** : ses déclarations uniquement, jamais les rapports médicaux. **Médecin** : le seul dossier pour lequel il est sollicité. |
| Authentification | Double authentification **obligatoire pour tous** : application d'authentification pour le back office ; code par e-mail (10 min, 5 essais) ou application pour les organisateurs ; prise en compte de la MFA du portail licencié (revendication `amr`). Mots de passe robustes (recommandation CNIL 2022), verrouillage après 5 échecs, sessions de 30 min d'inactivité / 12 h maximum. Médecins : lien personnel + code à usage unique (e-mail et SMS). |
| Traçabilité | Journal de toutes les connexions, consultations, téléchargements, exports, décisions. **Journal en ajout seul** : la base refuse toute modification ou suppression (déclencheurs), y compris par l'application. |
| Conservation | Dossiers supprimés automatiquement **10 ans** après la déclaration (`RETENTION_YEARS`), suppression tracée ; date de suppression affichée sur chaque dossier. Brouillons : 30 jours. |
| Minimisation des flux | Aucune donnée de santé ni identité de victime dans les e-mails et SMS. Export **pseudonymisé** pour les statistiques (sans nom, contact, texte libre ni signature ; dates au mois ; âge ; identifiant non réversible). Export complet réservé au service médical et tracé. |
| Fichiers | Contrôle du type réel des fichiers ; **analyse antivirus ClamAV** ; si l'antivirus est injoignable, le fichier est refusé. |
| Web | CSP stricte, en-têtes de sécurité (Helmet, HSTS), protection CSRF, `Referrer-Policy: no-referrer`, pas de cache, limitation du débit, aucun service tiers chargé par le navigateur (polices auto-hébergées). |
| Information | Page publique **« Données personnelles »** (mentions RGPD, à faire valider par le DPO : `PRIVACY_*`), liée sur toutes les pages et dans les formulaires ; communicable aux personnes accidentées. |
| Garde-fous | Le mode démonstration refuse de démarrer en production. Les comptes du back office ne sont jamais rattachés automatiquement à un compte licencié. |

## À configurer en production

- `DATA_ENCRYPTION_KEY_FILE` (ou `DATA_ENCRYPTION_KEY`) : clé issue du coffre de secrets de l'hébergeur, **conservée à part des sauvegardes**.
- `CLAMAV_HOST` : service antivirus (fourni dans `docker-compose.yml`).
- `PRIVACY_CONTROLLER`, `PRIVACY_DPO_CONTACT`, `PRIVACY_LEGAL_BASIS`, puis `PRIVACY_VALIDATED=true` après validation par le DPO.
- Compte de base de données de l'application sans droits d'administration (pas de `TRUNCATE`, pas de modification des déclencheurs).
- Export du journal d'audit vers l'outil de supervision de l'hébergeur.

## Obligations de la FFSA (hors application)

| Obligation | Référence | Action |
|---|---|---|
| Base légale | RGPD art. 6 et 9 | Déterminer le fondement, distinctement pour les licenciés et les non-licenciés (spectateurs). |
| Formalités CNIL | Loi Informatique et Libertés, art. 65 et s. | Vérifier si le traitement relève des formalités du chapitre « santé ». |
| Analyse d'impact (AIPD) | RGPD art. 35 | Très probablement obligatoire (données de santé à grande échelle). Outil PIA de la CNIL. |
| Registre | RGPD art. 30 | Inscrire le traitement. |
| Hébergement HDS | CSP art. L1111-8 | Hébergeur certifié HDS, hébergement dans l'EEE (référentiel 2024) ; privilégier un hébergeur non soumis aux lois extraterritoriales. Contrat avec clauses obligatoires. |
| Sous-traitants | RGPD art. 28 | Contrats : hébergeur, relais e-mail, fournisseur SMS. |
| Secret médical | CSP art. L1110-4 | Liste nominative des membres du service médical, engagement de confidentialité, revue périodique des accès. |
| Violations de données | RGPD art. 33-34 | Procédure : notification CNIL sous 72 h, information des personnes si risque élevé. |
| Sauvegardes | — | Chiffrées, testées, chez l'hébergeur HDS. |
| Données réelles | — | Jamais dans la démo en ligne ni dans les environnements de test. |

## Évolutions recommandées

- **Pro Santé Connect** (carte e-CPS) pour l'authentification des médecins.
- Revue de la minimisation des champs collectés (adresse, nationalité, date de naissance des blessés) dans le cadre de l'AIPD.
- Outil d'exercice des droits (recherche d'une personne, export de ses données) dans le back office.
