# Tester l'application (version de démonstration)

L'application démarre automatiquement : un onglet « Application FFSA » s'ouvre
(sinon : onglet **PORTS** en bas → port 3000 → icône globe).

> Données fictives uniquement : cette version n'est pas hébergée chez un hébergeur HDS.

## Comptes de démonstration

Sur la page de connexion, cliquez sur **Utiliser** à côté d'un compte.
Mot de passe commun : `Demo-FFSA-2026!`

| Compte | Rôle |
|---|---|
| organisateur@demo.ffsa.fr | Organisateur : déclare les accidents |
| medical@demo.ffsa.fr | Service médical : back office |
| admin@demo.ffsa.fr | Administrateur : back office + utilisateurs + audit |

Pour le Service médical et l'administrateur, le code de double authentification
est affiché à l'écran (en réel, il est lu dans une application sur téléphone).

## Scénario conseillé

1. Connectez-vous en **organisateur** et déclarez un accident (menu « Déclarer un accident »).
   Indiquez n'importe quelle adresse e-mail pour le médecin.
2. Aucun e-mail ne part réellement : ouvrez **« Voir les e-mails envoyés »** (bandeau jaune en haut).
3. Ouvrez le lien du message « Rapport médical à compléter » : vous êtes le **médecin**.
   Demandez le code, retrouvez-le dans la boîte mail de démo, puis saisissez un rapport par patient
   et cliquez sur « J'ai terminé ».
4. Déconnectez-vous, connectez-vous en **Service médical** et ouvrez le dossier dans le back office.

Pour arrêter : fermez le Codespace depuis github.com/codespaces (il s'arrête aussi seul après 30 minutes d'inactivité).
