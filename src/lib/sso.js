'use strict';

// Connexion par le compte licencié FFSA (OpenID Connect, code d'autorisation + PKCE).
const { Issuer, generators } = require('openid-client');
const config = require('../config');

let cached = null;

const isEnabled = () => Boolean(config.oidc.issuer && config.oidc.clientId);
const redirectUri = () => `${config.baseUrl}/connexion/sso/retour`;

async function getClient() {
  const key = `${config.oidc.issuer}|${config.oidc.clientId}|${redirectUri()}`;
  if (cached && cached.key === key) return cached.client;
  const issuer = await Issuer.discover(config.oidc.issuer);
  const client = new issuer.Client({
    client_id: config.oidc.clientId,
    client_secret: config.oidc.clientSecret || undefined,
    redirect_uris: [redirectUri()],
    response_types: ['code'],
    token_endpoint_auth_method: config.oidc.clientSecret ? 'client_secret_basic' : 'none',
  });
  cached = { key, client };
  return client;
}

// Prépare la redirection vers le fournisseur d'identité ; les secrets de la transaction restent en session
async function authorizationUrl(session) {
  const client = await getClient();
  const verifier = generators.codeVerifier();
  const state = generators.state();
  const nonce = generators.nonce();
  session.sso = { verifier, state, nonce, at: Date.now() };
  return client.authorizationUrl({
    scope: config.oidc.scopes,
    code_challenge: generators.codeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
}

// Valide le retour (state, nonce, PKCE, signature du jeton) et renvoie l'identité normalisée
async function handleCallback(req) {
  const tx = req.session.sso;
  delete req.session.sso;
  if (!tx || Date.now() - tx.at > 10 * 60 * 1000) throw new Error('Session de connexion expirée');
  const client = await getClient();
  const params = client.callbackParams(req);
  const tokenSet = await client.callback(redirectUri(), params, { code_verifier: tx.verifier, state: tx.state, nonce: tx.nonce });
  let claims = tokenSet.claims();
  if (!claims.email && tokenSet.access_token && client.issuer.userinfo_endpoint) {
    claims = { ...claims, ...(await client.userinfo(tokenSet)) };
  }
  if (config.oidc.requiredClaim) {
    const values = [].concat(claims[config.oidc.requiredClaim] || []).map(String);
    if (!values.some((v) => config.oidc.requiredValues.includes(v))) {
      const err = new Error('Profil non autorisé');
      err.code = 'NOT_ALLOWED';
      throw err;
    }
  }
  return {
    subject: `${claims.iss}|${claims.sub}`,
    email: String(claims.email || '').toLowerCase(),
    emailVerified: claims.email_verified !== false,
    firstName: claims.given_name || '',
    lastName: claims.family_name || '',
    fullName: claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' '),
    license: claims[config.oidc.licenseClaim] ? String(claims[config.oidc.licenseClaim]) : null,
    // Le portail a-t-il déjà imposé une double authentification ? (RFC 8176)
    mfa: [].concat(claims.amr || []).some((m) => ['mfa', 'otp', 'hwk', 'sms', 'swk', 'fpt', 'face'].includes(m)),
    organization: claims[config.oidc.organizationClaim] ? String(claims[config.oidc.organizationClaim]) : null,
  };
}

module.exports = { isEnabled, authorizationUrl, handleCallback, resetForTests: () => { cached = null; } };
