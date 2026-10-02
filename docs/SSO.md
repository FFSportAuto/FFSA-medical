# Accès des organisateurs : compte licencié FFSA (SSO) ou inscription

Les organisateurs créent leur accès eux-mêmes, par l'une de ces deux voies :

| Voie | Pour qui | Validation FFSA |
|---|---|---|
| **Compte licencié FFSA** (bouton « Se connecter avec mon compte licencié FFSA ») | Licenciés (directeurs de course, officiels, dirigeants d'ASA…) | Aucune : le compte est créé à la première connexion |
| **Inscription** (« Créer un compte ») | Organisateurs sans compte licencié | Oui : confirmation de l'e-mail, puis validation en un clic dans le back office (menu « Demandes ») |

Les comptes du **back office** (service médical, administrateurs) restent créés par invitation et
se connectent toujours avec mot de passe + double authentification ; ils ne sont jamais rattachés
automatiquement à un compte licencié.

## Ce que la DSI de la FFSA doit fournir pour le SSO

L'application utilise le standard **OpenID Connect** (flux « authorization code » avec PKCE), proposé
par la plupart des fournisseurs d'identité : Keycloak, Microsoft Entra ID (Azure AD), Okta, Auth0,
LemonLDAP::NG, Cerbère… Si l'espace licencié actuel repose sur un autre protocole (SAML, CAS), une
passerelle (par exemple Keycloak) peut l'exposer en OpenID Connect.

1. Déclarer un **client** (application) dans le fournisseur d'identité :
   - type : confidentiel (avec secret) ;
   - URL de redirection autorisée : `https://<adresse de l'application>/connexion/sso/retour` ;
   - portées : `openid email profile`.
2. Transmettre :
   - l'**URL de l'émetteur** (*issuer*), celle qui publie `/.well-known/openid-configuration` ;
   - l'**identifiant** et le **secret** du client.
3. S'assurer que le jeton d'identité (ou le point *userinfo*) contient :
   - `email` (obligatoire) et si possible `email_verified` ;
   - `given_name`, `family_name` ;
   - le **numéro de licence** (nom de la revendication à indiquer dans `OIDC_LICENSE_CLAIM`, par défaut `licence`).
4. Facultatif : pour réserver l'accès à certains profils (officiels, dirigeants d'ASA…), fournir une
   revendication de rôle et la configurer :
   `OIDC_REQUIRED_CLAIM=roles` et `OIDC_REQUIRED_VALUES=officiel,organisateur`.
   Les licenciés hors de ces profils sont invités à utiliser le formulaire d'inscription.

Variables d'environnement correspondantes : voir `.env.example` (`OIDC_*`, `APPROVER_EMAILS`).

## Rattachement des comptes

- À la première connexion par compte licencié, si un compte **organisateur** existe déjà avec la même
  adresse e-mail (vérifiée par le fournisseur), il est rattaché : l'organisateur retrouve ses déclarations.
- Une demande d'inscription en attente est validée automatiquement si la personne se connecte ensuite
  avec son compte licencié.

## Sécurité de l'inscription libre

- Confirmation de l'adresse e-mail obligatoire (lien valable 48 h), puis validation par la FFSA.
- Les personnes de `APPROVER_EMAILS` (par défaut le service médical) sont prévenues de chaque demande.
- Réponse identique que l'adresse soit connue ou non (pas de divulgation des comptes existants).
- Limitation du nombre de demandes, champ piège anti-robots, mot de passe robuste.
- Un organisateur ne voit que ses propres déclarations, jamais les rapports médicaux.

## Démonstration

En mode démo (`DEMO_MODE=true`) et sans `OIDC_ISSUER`, un **portail licencié simulé** (`/demo/sso`)
remplace le vrai fournisseur : on y choisit un licencié fictif. Il n'est jamais actif en production.
