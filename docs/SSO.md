# Accès des directeurs de course : compte licencié FFSA (SSO) ou inscription

**Choix actuel** : seule l'**inscription** (« Créer un compte ») est proposée. Le compte est actif dès que
l'adresse e-mail est confirmée, sans validation par la FFSA. La connexion avec le compte licencié décrite
ci-dessous reste disponible dans le code : le bouton n'apparaît que si `OIDC_ISSUER` est configuré.

| Voie | Pour qui | Validation FFSA |
|---|---|---|
| **Inscription** (« Créer un compte ») | Tous les directeurs de course | Aucune : compte actif après confirmation de l'e-mail |
| **Compte licencié FFSA** (si activé) | Licenciés (directeurs de course, officiels, dirigeants d'ASA…) | Aucune : le compte est créé à la première connexion |

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
   - le **numéro de licence** (nom de la revendication à indiquer dans `OIDC_LICENSE_CLAIM`, par défaut `licence`) ;
   - si possible l'**ASA** du licencié (`OIDC_ORGANIZATION_CLAIM`, par défaut `asa`), affichée dans le menu
     et reprise dans le formulaire d'accident.
4. Facultatif : pour réserver l'accès à certains profils (officiels, dirigeants d'ASA…), fournir une
   revendication de rôle et la configurer :
   `OIDC_REQUIRED_CLAIM=roles` et `OIDC_REQUIRED_VALUES=officiel,organisateur`.
   Les licenciés hors de ces profils sont invités à utiliser le formulaire d'inscription.

Variables d'environnement correspondantes : voir `.env.example` (`OIDC_*`).

## Rattachement des comptes

- À la première connexion par compte licencié, si un compte **directeur de course** existe déjà avec la même
  adresse e-mail (vérifiée par le fournisseur), il est rattaché : le directeur de course retrouve ses déclarations.
- Une inscription dont l'adresse n'est pas encore confirmée est activée si la personne se connecte ensuite
  avec son compte licencié.

## Sécurité de l'inscription libre

- Confirmation de l'adresse e-mail obligatoire (lien valable 48 h) : le compte est ensuite actif.
- Réponse identique que l'adresse soit connue ou non (pas de divulgation des comptes existants).
- Limitation du nombre de demandes, champ piège anti-robots, mot de passe robuste.
- Un directeur de course ne voit que ses propres déclarations, jamais les rapports médicaux.

## Tests

Les tests automatiques utilisent un **portail licencié simulé** (`src/sso-demo-idp.js`). Il n'est plus proposé
dans la démonstration.
