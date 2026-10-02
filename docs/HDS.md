# Sécurité et hébergement HDS

## Mesures intégrées à l'application

| Exigence | Mise en œuvre |
|---|---|
| Confidentialité des données de santé | Chiffrement applicatif AES-256-GCM des formulaires, pièces jointes, e-mails des médecins et secrets TOTP (`DATA_ENCRYPTION_KEY`). Seuls épreuve, date et discipline sont en clair pour la recherche. |
| Authentification forte | Mots de passe scrypt (12 car. min, 3 classes), TOTP obligatoire pour le back office, verrouillage 15 min après 5 échecs, limitation de débit. |
| Accès médecin | Lien aléatoire 256 bits (seule l'empreinte SHA-256 est stockée), expiration, révocation au renvoi, code à usage unique par e-mail (10 min, 5 essais), soumission unique. |
| Cloisonnement | Organisateur : ses seules déclarations, jamais le rapport médical. Médecin : un seul dossier. |
| Traçabilité | Journal d'audit : connexions, échecs, consultations de dossier, téléchargements, exports, gestion des comptes (sans donnée de santé). |
| Sessions | Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, expiration après 30 min d'inactivité et 12 h max, régénération à la connexion, stockage PostgreSQL. |
| Web | CSP stricte, en-têtes Helmet, protection CSRF, `Referrer-Policy: no-referrer` (protège les liens médecin), `Cache-Control: no-store`, contrôle du type réel des fichiers, neutralisation des formules dans l'export CSV. |
| E-mails | Aucune donnée de santé ni identité de victime dans les messages. SMTP en TLS. |

## Check-list hébergement (à réaliser avec l'hébergeur HDS)

- [ ] Hébergeur certifié HDS (niveau « hébergeur d'infrastructure physique » + « infogérance » selon le contrat) — ex. OVHcloud, Scaleway, Outscale, Claranet, etc.
- [ ] Contrat d'hébergement HDS signé (art. L.1111-8 CSP) ; DPA RGPD.
- [ ] TLS 1.2+ via reverse proxy ; HSTS.
- [ ] Base PostgreSQL non exposée sur Internet ; chiffrement disque.
- [ ] Sauvegardes chiffrées, testées, hébergées HDS (la `DATA_ENCRYPTION_KEY` est stockée **à part**, dans un coffre de secrets).
- [ ] Relais SMTP (idéalement hébergé en France/UE).
- [ ] Supervision, mises à jour de sécurité (`npm audit`, image Docker).
- [ ] Conservation des journaux d'audit et des logs techniques.

## Points RGPD à traiter par la FFSA

- Registre des traitements, base légale, AIPD (traitement de données de santé à grande échelle).
- Information des personnes accidentées (mentions d'information).
- Durée de conservation des dossiers et procédure de purge.
- Désignation des personnes habilitées du service médical (secret médical).
