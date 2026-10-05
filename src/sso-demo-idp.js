'use strict';

// Portail licencié FFSA SIMULÉ (fournisseur OpenID Connect minimal) pour la démonstration et les tests.
// Ne jamais utiliser en production : il accepte n'importe quelle identité fictive.
const crypto = require('crypto');
const express = require('express');
const jose = require('jose');

const DEMO_LICENSEES = [
  { sub: 'lic-201501', given_name: 'Camille', family_name: 'Laurent', email: 'camille.laurent@asa-demo.fr', licence: '201501', roles: ['officiel', 'organisateur'], asa: 'ASA Démo Ouest' },
  { sub: 'lic-178842', given_name: 'Karim', family_name: 'Benali', email: 'karim.benali@asa-demo.fr', licence: '178842', roles: ['officiel'], asa: 'ASA Démo Sud' },
];

function createDemoIdp({ publicBase, internalIssuer, clientId, clientSecret }) {
  const router = express.Router();
  const codes = new Map();
  const keysReady = jose.generateKeyPair('RS256').then(async ({ publicKey, privateKey }) => {
    const jwk = await jose.exportJWK(publicKey);
    return { privateKey, jwk: { ...jwk, kid: 'demo', alg: 'RS256', use: 'sig' } };
  });

  router.get('/.well-known/openid-configuration', (req, res) => {
    res.json({
      issuer: internalIssuer(),
      authorization_endpoint: `${publicBase()}/authorize`,
      token_endpoint: `${internalIssuer()}/token`,
      jwks_uri: `${internalIssuer()}/jwks`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
      scopes_supported: ['openid', 'email', 'profile'],
    });
  });

  router.get('/jwks', async (req, res) => res.json({ keys: [(await keysReady).jwk] }));

  // Page « portail licencié » : on choisit un licencié fictif
  router.get('/authorize', (req, res) => {
    const q = req.query;
    if (q.client_id !== clientId || q.response_type !== 'code' || !q.redirect_uri) return res.status(400).send('Requête invalide');
    res.render('demo/sso', { title: 'Portail licenciés FFSA (simulation)', licensees: DEMO_LICENSEES, q });
  });

  router.post('/authorize', (req, res) => {
    const b = req.body;
    const person = DEMO_LICENSEES.find((l) => l.sub === b.sub);
    if (!person || b.client_id !== clientId) return res.status(400).send('Requête invalide');
    const code = crypto.randomBytes(24).toString('base64url');
    codes.set(code, { person, nonce: b.nonce, challenge: b.code_challenge, redirectUri: b.redirect_uri, at: Date.now() });
    const url = new URL(b.redirect_uri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', b.state);
    res.redirect(url.toString());
  });

  router.post('/token', async (req, res) => {
    const auth = (req.get('authorization') || '').replace(/^Basic /, '');
    const [id, secret] = auth ? Buffer.from(auth, 'base64').toString().split(':').map(decodeURIComponent) : [req.body.client_id, req.body.client_secret];
    const entry = codes.get(req.body.code);
    codes.delete(req.body.code);
    const challenge = crypto.createHash('sha256').update(String(req.body.code_verifier || '')).digest('base64url');
    if (id !== clientId || secret !== clientSecret || !entry || entry.challenge !== challenge || entry.redirectUri !== req.body.redirect_uri || Date.now() - entry.at > 120000) {
      return res.status(400).json({ error: 'invalid_grant' });
    }
    const { privateKey } = await keysReady;
    const p = entry.person;
    const idToken = await new jose.SignJWT({
      nonce: entry.nonce, email: p.email, email_verified: true, given_name: p.given_name, family_name: p.family_name,
      name: `${p.given_name} ${p.family_name}`, licence: p.licence, roles: p.roles, asa: p.asa,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'demo' })
      .setIssuer(internalIssuer()).setAudience(clientId).setSubject(p.sub)
      .setIssuedAt().setExpirationTime('5m')
      .sign(privateKey);
    res.json({ access_token: crypto.randomBytes(16).toString('hex'), token_type: 'Bearer', expires_in: 300, id_token: idToken });
  });

  return router;
}

module.exports = { createDemoIdp, DEMO_LICENSEES };
