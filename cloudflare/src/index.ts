interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

interface D1Database {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result<unknown>[]>;
}

interface QueueProducer {
  send(message: unknown): Promise<void>;
}

interface QueueMessage<T> {
  body: T;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

interface QueueBatch<T> {
  messages: QueueMessage<T>[];
}

interface Env {
  DB: D1Database;
  RUN_QUEUE: QueueProducer;
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_PUBLIC_URL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  AUTH_TOKEN_ENCRYPTION_KEY?: string;
  GITHUB_WORKFLOW_FILE?: string;
}

interface RunRow {
  id: string;
  installation_id: number;
  repository_id: number;
  repository_owner: string;
  repository_name: string;
  default_branch: string;
  pull_request_number: number;
  pull_request_title: string;
  base_ref: string;
  head_ref: string;
  base_sha: string;
  head_sha: string;
  status: string;
  workflow_run_id: number | null;
  workflow_url: string | null;
  failure_reason: string | null;
  check_results: string;
  impact: string;
  created_at: string;
}

interface UserRow {
  github_user_id: number;
  login: string;
  display_name: string | null;
  avatar_url: string | null;
  access_token_ciphertext: string | null;
  refresh_token_ciphertext: string | null;
  access_token_expires_at: number | null;
  refresh_token_expires_at: number | null;
}

const API_VERSION = '2026-03-10';
const MAX_WEBHOOK_BYTES = 512 * 1024;
const MAX_REPORT_BYTES = 512 * 1024;
const PULL_REQUEST_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  if (cookie) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function asBufferSource(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function decodeText(value: ArrayBuffer | Uint8Array): string {
  return new TextDecoder().decode(value instanceof Uint8Array ? value : new Uint8Array(value));
}

function cookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) {
      try { result.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())); }
      catch { /* Ignore malformed cookie values. */ }
    }
  }
  return result;
}

function cookie(name: string, value: string, request: Request, options: { path?: string; maxAge?: number } = {}): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=${options.path ?? '/'}; HttpOnly; SameSite=Lax${secure}${options.maxAge === undefined ? '' : `; Max-Age=${options.maxAge}`}`;
}

function expiredCookie(name: string, request: Request, path = '/'): string {
  return cookie(name, '', request, { path, maxAge: 0 });
}

function getAppUrl(env: Env, request: Request): string {
  return (env.APP_PUBLIC_URL?.trim() || new URL(request.url).origin).replace(/\/$/u, '');
}

function requireEnv(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is not configured`);
  return value.trim();
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asBufferSource(encodeText(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signedSession(userId: number, env: Env): Promise<string> {
  const secret = requireEnv(env.SESSION_SECRET, 'Session signing secret');
  const payload = base64Url(encodeText(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60 })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), asBufferSource(encodeText(payload)));
  return `${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function sessionUserId(request: Request, env: Env): Promise<number | null> {
  const token = cookies(request).get('diffharbor_session');
  const [payload, signature, extra] = token?.split('.') ?? [];
  if (!payload || !signature || extra) return null;
  try {
    const secret = requireEnv(env.SESSION_SECRET, 'Session signing secret');
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), asBufferSource(decodeBase64Url(signature)), asBufferSource(encodeText(payload)));
    if (!valid) return null;
    const data = JSON.parse(decodeText(decodeBase64Url(payload))) as { uid?: number; exp?: number };
    if (!Number.isSafeInteger(data.uid) || !Number.isSafeInteger(data.exp) || Number(data.exp) <= Date.now() / 1000) return null;
    return Number(data.uid);
  } catch {
    return null;
  }
}

function encryptionKeyBytes(env: Env): Uint8Array {
  const value = requireEnv(env.AUTH_TOKEN_ENCRYPTION_KEY, 'GitHub token encryption key');
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(value.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, ''));
  } catch {
    throw new Error('GitHub token encryption key must be base64-encoded');
  }
  if (bytes.length !== 32) throw new Error('GitHub token encryption key must decode to 32 bytes');
  return bytes;
}

async function encryptToken(token: string, env: Env): Promise<string> {
  const key = await crypto.subtle.importKey('raw', asBufferSource(encryptionKeyBytes(env)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: asBufferSource(iv) }, key, asBufferSource(encodeText(token)));
  return `${base64Url(iv)}.${base64Url(new Uint8Array(ciphertext))}`;
}

async function decryptToken(value: string, env: Env): Promise<string> {
  try {
    const [ivPart, ciphertextPart] = value.split('.');
    if (!ivPart || !ciphertextPart) throw new Error('Invalid encrypted token');
    const key = await crypto.subtle.importKey('raw', asBufferSource(encryptionKeyBytes(env)), 'AES-GCM', false, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asBufferSource(decodeBase64Url(ivPart)) },
      key,
      asBufferSource(decodeBase64Url(ciphertextPart)),
    );
    return decodeText(plaintext);
  } catch {
    throw new Error('GitHub authorization expired. Sign in again.');
  }
}

async function apiFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', API_VERSION);
  return fetch(path.startsWith('https://') ? path : `https://api.github.com${path}`, { ...init, headers });
}

async function getUser(userId: number, env: Env): Promise<UserRow | null> {
  return env.DB.prepare('SELECT * FROM github_users WHERE github_user_id = ?1').bind(userId).first<UserRow>();
}

async function saveUserToken(userId: number, tokenData: Record<string, unknown>, env: Env): Promise<string> {
  const accessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
  if (!accessToken) throw new Error('GitHub did not return an access token');
  const refreshToken = typeof tokenData.refresh_token === 'string' ? tokenData.refresh_token : null;
  const now = Math.floor(Date.now() / 1000);
  const accessExpires = Number.isFinite(Number(tokenData.expires_in)) ? now + Number(tokenData.expires_in) : null;
  const refreshExpires = Number.isFinite(Number(tokenData.refresh_token_expires_in)) ? now + Number(tokenData.refresh_token_expires_in) : null;
  await env.DB.prepare(`UPDATE github_users SET access_token_ciphertext = ?1, refresh_token_ciphertext = ?2,
    access_token_expires_at = ?3, refresh_token_expires_at = ?4, updated_at = CURRENT_TIMESTAMP
    WHERE github_user_id = ?5`).bind(
    await encryptToken(accessToken, env),
    refreshToken ? await encryptToken(refreshToken, env) : null,
    accessExpires,
    refreshExpires,
    userId,
  ).run();
  return accessToken;
}

async function userAccessToken(user: UserRow, env: Env): Promise<string> {
  if (!user.access_token_ciphertext) throw new Error('GitHub authorization expired. Sign in again.');
  const now = Math.floor(Date.now() / 1000);
  if (!user.access_token_expires_at || user.access_token_expires_at > now + 60) {
    return decryptToken(user.access_token_ciphertext, env);
  }
  if (!user.refresh_token_ciphertext || !user.refresh_token_expires_at || user.refresh_token_expires_at <= now) {
    await env.DB.prepare(`UPDATE github_users SET access_token_ciphertext = NULL, refresh_token_ciphertext = NULL,
      access_token_expires_at = NULL, refresh_token_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE github_user_id = ?1`).bind(user.github_user_id).run();
    throw new Error('GitHub authorization expired. Sign in again.');
  }
  const form = new URLSearchParams({
    client_id: requireEnv(env.GITHUB_CLIENT_ID, 'GitHub OAuth client ID'),
    client_secret: requireEnv(env.GITHUB_CLIENT_SECRET, 'GitHub OAuth client secret'),
    grant_type: 'refresh_token',
    refresh_token: await decryptToken(user.refresh_token_ciphertext, env),
  });
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!response.ok) throw new Error('GitHub authorization expired. Sign in again.');
  const data = await response.json() as Record<string, unknown>;
  const freshToken = await saveUserToken(user.github_user_id, data, env);
  return freshToken;
}

function nextPage(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/u);
  if (!match) return null;
  const next = new URL(match[1]);
  return next.origin === 'https://api.github.com' ? next.toString() : null;
}

async function accessiblePublicRepositories(user: UserRow, env: Env): Promise<number[]> {
  const token = await userAccessToken(user, env);
  const repositoryIds = new Set<number>();
  let installationsUrl: string | null = 'https://api.github.com/user/installations?per_page=100';
  for (let page = 0; installationsUrl && page < 100; page += 1) {
    const response = await apiFetch(installationsUrl, token);
    if (!response.ok) throw new Error('Could not verify GitHub installation access.');
    const body = await response.json() as { installations?: Array<{ id?: number }> };
    const installations = body.installations ?? [];
    for (const installation of installations) {
      if (!Number.isSafeInteger(installation.id)) continue;
      let repositoriesUrl: string | null = `https://api.github.com/user/installations/${installation.id}/repositories?per_page=100`;
      for (let repositoryPage = 0; repositoriesUrl && repositoryPage < 100; repositoryPage += 1) {
        const repositoryResponse = await apiFetch(repositoriesUrl, token);
        if (!repositoryResponse.ok) throw new Error('Could not verify public repositories for a GitHub installation.');
        const payload = await repositoryResponse.json() as { repositories?: Array<{ id?: number; private?: boolean }> };
        for (const repository of payload.repositories ?? []) {
          if (repository.private === false && Number.isSafeInteger(repository.id)) repositoryIds.add(Number(repository.id));
        }
        repositoriesUrl = nextPage(repositoryResponse.headers.get('Link'));
      }
    }
    installationsUrl = nextPage(response.headers.get('Link'));
  }
  return [...repositoryIds];
}

function b64UrlJson(value: unknown): string {
  return base64Url(encodeText(JSON.stringify(value)));
}

function derLength(length: number): Uint8Array {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, body: Uint8Array): Uint8Array {
  const length = derLength(body.length);
  const result = new Uint8Array(1 + length.length + body.length);
  result[0] = tag;
  result.set(length, 1);
  result.set(body, 1 + length.length);
  return result;
}

function concatenate(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function appPrivateKeyDer(pem: string): Uint8Array {
  const cleaned = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/gu, '');
  const key = Uint8Array.from(atob(cleaned), (character) => character.charCodeAt(0));
  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    const algorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
    return der(0x30, concatenate(der(0x02, Uint8Array.of(0)), algorithm, der(0x04, key)));
  }
  return key;
}

async function createAppJwt(env: Env): Promise<string> {
  const appId = requireEnv(env.GITHUB_APP_ID, 'GitHub App ID');
  const privateKeyPem = requireEnv(env.GITHUB_APP_PRIVATE_KEY, 'GitHub App private key');
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    asBufferSource(appPrivateKeyDer(privateKeyPem)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64UrlJson({ alg: 'RS256', typ: 'JWT' })}.${b64UrlJson({ iat: now - 60, exp: now + 9 * 60, iss: appId })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, asBufferSource(encodeText(unsigned)));
  return `${unsigned}.${base64Url(new Uint8Array(signature))}`;
}

async function installationToken(installationId: number, env: Env): Promise<string> {
  const jwt = await createAppJwt(env);
  const response = await apiFetch(`/app/installations/${installationId}/access_tokens`, jwt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ permissions: { actions: 'write', contents: 'read', pull_requests: 'read' } }),
  });
  if (response.status !== 201) throw new Error(`GitHub installation token request failed (${response.status}).`);
  const payload = await response.json() as { token?: string };
  if (!payload.token) throw new Error('GitHub did not return an installation token.');
  return payload.token;
}

async function canApproveFork(installationId: number, owner: string, repo: string, username: string, env: Env): Promise<boolean> {
  const token = await installationToken(installationId, env);
  const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}/permission`;
  const response = await apiFetch(path, token);
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`Could not verify repository permission (${response.status}).`);
  const payload = await response.json() as { permission?: string };
  return payload.permission === 'write' || payload.permission === 'admin';
}

async function dispatchWorkflow(run: RunRow, env: Env): Promise<void> {
  const token = await installationToken(run.installation_id, env);
  const workflowFile = env.GITHUB_WORKFLOW_FILE?.trim() || 'changeguard.yml';
  const workflowPath = workflowFile.split('/').map(encodeURIComponent).join('/');
  const endpoint = `/repos/${encodeURIComponent(run.repository_owner)}/${encodeURIComponent(run.repository_name)}/actions/workflows/${workflowPath}/dispatches`;
  const response = await apiFetch(endpoint, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ref: run.default_branch,
      inputs: {
        changeguard_run_id: run.id,
        pull_request_number: String(run.pull_request_number),
        base_sha: run.base_sha,
        head_sha: run.head_sha,
        diffharbor_url: requireEnv(env.APP_PUBLIC_URL, 'Public app URL').replace(/\/$/u, ''),
      },
    }),
  });
  if (response.status !== 204 && !response.ok) throw new Error(`GitHub workflow dispatch failed (${response.status}).`);
}

async function dispatchRun(runId: string, env: Env): Promise<void> {
  const run = await env.DB.prepare('SELECT * FROM rehearsal_runs WHERE id = ?1').bind(runId).first<RunRow>();
  if (!run || run.status !== 'queued') return;
  const claimed = await env.DB.prepare(`UPDATE rehearsal_runs SET status = 'dispatching', failure_reason = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status = 'queued'`).bind(runId).run();
  if (Number(claimed.meta.changes ?? 0) === 0) return;
  try {
    await dispatchWorkflow(run, env);
    await env.DB.prepare(`UPDATE rehearsal_runs SET status = 'running', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?1 AND status = 'dispatching'`).bind(runId).run();
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 1000) : 'Could not dispatch the GitHub Actions workflow.';
    await env.DB.prepare(`UPDATE rehearsal_runs SET status = 'queued', failure_reason = ?1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?2 AND status = 'dispatching'`).bind(reason, runId).run();
    throw error;
  }
}

function safeJson(text: string, fallback: unknown): unknown {
  try { return JSON.parse(text); } catch { return fallback; }
}

function publicRun(row: RunRow): Record<string, unknown> {
  return {
    id: row.id,
    repository_owner: row.repository_owner,
    repository_name: row.repository_name,
    pull_request_number: row.pull_request_number,
    pull_request_title: row.pull_request_title,
    base_sha: row.base_sha,
    head_sha: row.head_sha,
    status: row.status,
    workflow_url: row.workflow_url,
    failure_reason: row.failure_reason,
    check_results: safeJson(row.check_results, []),
    impact: safeJson(row.impact, {}),
    created_at: row.created_at,
  };
}

function basicFinding(item: unknown): Record<string, unknown> | null {
  if (!item || typeof item !== 'object') return null;
  const value = item as Record<string, unknown>;
  const confidenceValue = Number(value.confidence);
  const line = Number(value.line_start);
  return {
    id: crypto.randomUUID(),
    category: String(value.category ?? 'verification').slice(0, 40),
    severity: String(value.severity ?? 'info').slice(0, 16),
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0.5,
    title: String(value.title ?? 'Rehearsal finding').slice(0, 300),
    description: String(value.description ?? '').slice(0, 5000),
    file_path: value.file_path ? String(value.file_path).slice(0, 2000) : null,
    line_start: Number.isSafeInteger(line) && line > 0 ? line : null,
    evidence: JSON.stringify(value.evidence && typeof value.evidence === 'object' ? value.evidence : {}),
  };
}

async function githubOidcClaims(token: string): Promise<Record<string, unknown>> {
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('GitHub Actions identity token is invalid.');
  const header = JSON.parse(decodeText(decodeBase64Url(headerPart))) as { alg?: string; kid?: string };
  const claims = JSON.parse(decodeText(decodeBase64Url(payloadPart))) as Record<string, unknown>;
  if (header.alg !== 'RS256' || !header.kid) throw new Error('GitHub Actions identity token algorithm is not supported.');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Number(claims.exp);
  const issuedAt = Number(claims.iat);
  const notBefore = claims.nbf === undefined ? null : Number(claims.nbf);
  if (
    claims.iss !== 'https://token.actions.githubusercontent.com'
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(issuedAt)
    || expiresAt < now - 10
    || issuedAt > now + 10
    || (notBefore !== null && (!Number.isFinite(notBefore) || notBefore > now + 10))
  ) {
    throw new Error('GitHub Actions identity token has expired or has the wrong issuer.');
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes('diffharbor')) throw new Error('GitHub Actions identity token has the wrong audience.');
  const keyResponse = await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
  if (!keyResponse.ok) throw new Error('Could not verify the GitHub Actions identity token.');
  const keySet = await keyResponse.json() as { keys?: JsonWebKey[] };
  const keyData = (keySet.keys ?? []).find((key) => (key as JsonWebKey & { kid?: string }).kid === header.kid);
  if (!keyData) throw new Error('GitHub Actions identity token signing key was not found.');
  const key = await crypto.subtle.importKey('jwk', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    asBufferSource(decodeBase64Url(signaturePart)),
    asBufferSource(encodeText(`${headerPart}.${payloadPart}`)),
  );
  if (!valid) throw new Error('GitHub Actions identity token signature did not match.');
  return claims;
}

function reportMatchesRun(claims: Record<string, unknown>, run: RunRow, env: Env): boolean {
  const repository = `${run.repository_owner}/${run.repository_name}`.toLowerCase();
  const file = env.GITHUB_WORKFLOW_FILE?.trim() || 'changeguard.yml';
  const workflowRef = `${repository}/.github/workflows/${file}@refs/heads/${run.default_branch}`.toLowerCase();
  return String(claims.repository_id) === String(run.repository_id)
    && String(claims.repository).toLowerCase() === repository
    && claims.event_name === 'workflow_dispatch'
    && String(claims.ref) === `refs/heads/${run.default_branch}`
    && String(claims.workflow_ref).toLowerCase() === workflowRef;
}

async function verifyActionsRun(claims: Record<string, unknown>, run: RunRow, env: Env): Promise<number | null> {
  const workflowRunId = Number(claims.run_id);
  if (!Number.isSafeInteger(workflowRunId)) return null;
  const token = await installationToken(run.installation_id, env);
  const endpoint = `/repos/${encodeURIComponent(run.repository_owner)}/${encodeURIComponent(run.repository_name)}/actions/runs/${workflowRunId}`;
  const response = await apiFetch(endpoint, token);
  if (!response.ok) return null;
  const actionRun = await response.json() as Record<string, unknown>;
  const expectedFile = `.github/workflows/${env.GITHUB_WORKFLOW_FILE?.trim() || 'changeguard.yml'}`;
  const runPath = typeof actionRun.path === 'string' ? actionRun.path.split('@', 1)[0] : '';
  if (
    actionRun.event !== 'workflow_dispatch'
    || actionRun.display_title !== `DiffHarbor rehearsal ${run.id}`
    || actionRun.head_branch !== run.default_branch
    || runPath !== expectedFile
  ) return null;
  return workflowRunId;
}

async function acceptReport(request: Request, runId: string, env: Env): Promise<Response> {
  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ detail: 'GitHub Actions identity token is required.' }, 401);
  const run = await env.DB.prepare('SELECT * FROM rehearsal_runs WHERE id = ?1').bind(runId).first<RunRow>();
  if (!run) return json({ detail: 'Rehearsal run was not found.' }, 404);
  const claims = await githubOidcClaims(authorization.slice(7));
  if (!reportMatchesRun(claims, run, env)) return json({ detail: 'GitHub Actions run does not match this rehearsal.' }, 403);
  const workflowRunId = await verifyActionsRun(claims, run, env);
  if (!workflowRunId) return json({ detail: 'GitHub could not confirm the workflow run for this rehearsal.' }, 403);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_REPORT_BYTES) return json({ detail: 'Rehearsal report is too large.' }, 413);
  let report: Record<string, unknown>;
  try { report = JSON.parse(decodeText(bytes)) as Record<string, unknown>; }
  catch { return json({ detail: 'Rehearsal report must be valid JSON.' }, 400); }
  if (report.run_id !== runId || report.base_sha !== run.base_sha || report.head_sha !== run.head_sha) {
    return json({ detail: 'Rehearsal report commit evidence does not match this pull request.' }, 403);
  }
  const summary = report.summary && typeof report.summary === 'object' ? report.summary as Record<string, unknown> : {};
  if (summary.status !== 'passed' && summary.status !== 'failed') return json({ detail: 'Rehearsal report is missing its result summary.' }, 400);
  const checks = Array.isArray(report.checks) ? report.checks.slice(0, 100) : [];
  const findings = Array.isArray(report.findings) ? report.findings.slice(0, 100).map(basicFinding).filter((item): item is Record<string, unknown> => item !== null) : [];
  const impact = report.impact && typeof report.impact === 'object' ? report.impact : {};
  const impactJson = JSON.stringify(impact);
  if (impactJson.length > 512 * 1024) return json({ detail: 'Impact analysis is too large.' }, 413);

  const workflowUrl = `https://github.com/${run.repository_owner}/${run.repository_name}/actions/runs/${workflowRunId}`;
  const failureReason = typeof summary.message === 'string' ? summary.message.slice(0, 1000) : null;
  const statements: D1Statement[] = [
    env.DB.prepare(`UPDATE rehearsal_runs SET status = ?1, workflow_run_id = COALESCE(?2, workflow_run_id),
      workflow_url = COALESCE(?3, workflow_url), failure_reason = ?4, check_results = ?5, impact = ?6,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?7`).bind(
      summary.status === 'passed' ? 'completed' : 'failed',
      workflowRunId,
      workflowUrl,
      failureReason,
      JSON.stringify(checks),
      impactJson,
      runId,
    ),
    env.DB.prepare('DELETE FROM findings WHERE run_id = ?1').bind(runId),
  ];
  for (const finding of findings) {
    statements.push(env.DB.prepare(`INSERT INTO findings
      (id, run_id, category, severity, confidence, title, description, file_path, line_start, evidence)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
      finding.id, runId, finding.category, finding.severity, finding.confidence, finding.title,
      finding.description, finding.file_path, finding.line_start, finding.evidence,
    ));
  }
  await env.DB.batch(statements);
  return json({ accepted: true, status: summary.status }, 202);
}

async function readBody(request: Request, maxBytes: number): Promise<Uint8Array | Response> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > maxBytes) {
    return json({ detail: 'Request body is too large.' }, 413);
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      return json({ detail: 'Request body is too large.' }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function verifyWebhook(body: Uint8Array, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), asBufferSource(body)));
  let provided: Uint8Array;
  try {
    const hex = signature.slice('sha256='.length);
    if (!/^[0-9a-f]{64}$/iu.test(hex)) return false;
    provided = Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
  } catch { return false; }
  if (expected.length !== provided.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected[index] ^ provided[index];
  return mismatch === 0;
}

function installationFrom(payload: Record<string, unknown>): { id: number; login: string; type: string; selection: string } | null {
  const installation = payload.installation as Record<string, unknown> | undefined;
  const account = installation?.account as Record<string, unknown> | undefined;
  if (!installation || !account || !Number.isSafeInteger(installation.id)) return null;
  return {
    id: Number(installation.id),
    login: String(account.login ?? 'unknown'),
    type: String(account.type ?? 'User'),
    selection: String(installation.repository_selection ?? 'selected'),
  };
}

async function upsertInstallation(payload: Record<string, unknown>, env: Env, active = true): Promise<number | null> {
  const details = installationFrom(payload);
  if (!details) return null;
  await env.DB.prepare(`INSERT INTO github_installations
    (installation_id, account_login, account_type, repository_selection, active, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
    ON CONFLICT(installation_id) DO UPDATE SET account_login = excluded.account_login,
      account_type = excluded.account_type, repository_selection = excluded.repository_selection,
      active = excluded.active, updated_at = CURRENT_TIMESTAMP`).bind(
    details.id, details.login, details.type, details.selection, active ? 1 : 0,
  ).run();
  return details.id;
}

async function createPullRequestRun(payload: Record<string, unknown>, installationId: number, env: Env): Promise<{ id: string | null; sameRepo: boolean }> {
  const repository = payload.repository as Record<string, unknown> | undefined;
  const pull = payload.pull_request as Record<string, unknown> | undefined;
  const owner = repository?.owner as Record<string, unknown> | undefined;
  const base = pull?.base as Record<string, unknown> | undefined;
  const head = pull?.head as Record<string, unknown> | undefined;
  const headRepo = head?.repo as Record<string, unknown> | null | undefined;
  if (!repository || !pull || !owner || !base || !head || !Number.isSafeInteger(repository.id) || !Number.isSafeInteger(payload.number)) {
    return { id: null, sameRepo: false };
  }
  const baseSha = String(base.sha ?? '');
  const headSha = String(head.sha ?? '');
  if (!baseSha || !headSha || !owner.login || !repository.name) return { id: null, sameRepo: false };
  const sameRepo = headRepo?.id === repository.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO rehearsal_runs
    (id, installation_id, repository_id, repository_owner, repository_name, default_branch,
     pull_request_number, pull_request_title, base_ref, head_ref, base_sha, head_sha, status)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    ON CONFLICT(repository_id, pull_request_number, head_sha) DO NOTHING`).bind(
    id,
    installationId,
    Number(repository.id),
    String(owner.login),
    String(repository.name),
    String(repository.default_branch ?? base.ref ?? 'main'),
    Number(payload.number),
    String(pull.title ?? 'Untitled pull request').slice(0, 5000),
    String(base.ref ?? ''),
    String(head.ref ?? ''),
    baseSha,
    headSha,
    sameRepo ? 'queued' : 'approval_required',
  ).run();
  const existing = await env.DB.prepare(`SELECT id FROM rehearsal_runs
    WHERE repository_id = ?1 AND pull_request_number = ?2 AND head_sha = ?3`).bind(
    Number(repository.id), Number(payload.number), headSha,
  ).first<{ id: string }>();
  return { id: existing?.id ?? null, sameRepo };
}

async function approveFork(payload: Record<string, unknown>, env: Env): Promise<string | null> {
  const review = payload.review as Record<string, unknown> | undefined;
  const repository = payload.repository as Record<string, unknown> | undefined;
  const pull = payload.pull_request as Record<string, unknown> | undefined;
  const reviewer = review?.user as Record<string, unknown> | undefined;
  const head = pull?.head as Record<string, unknown> | undefined;
  const headRepo = head?.repo as Record<string, unknown> | null | undefined;
  const owner = repository?.owner as Record<string, unknown> | undefined;
  const installation = payload.installation as Record<string, unknown> | undefined;
  if (review?.state !== 'approved' || !repository || !pull || !reviewer || !head || !owner || !installation) return null;
  const currentSha = String(head.sha ?? '');
  if (!currentSha || String(review.commit_id ?? '') !== currentSha || headRepo?.id === repository.id) return null;
  if (!Number.isSafeInteger(installation.id) || !Number.isSafeInteger(repository.id) || !Number.isSafeInteger(payload.number)) return null;
  if (!await canApproveFork(Number(installation.id), String(owner.login), String(repository.name), String(reviewer.login), env)) return null;
  const run = await env.DB.prepare(`SELECT id FROM rehearsal_runs WHERE repository_id = ?1
    AND pull_request_number = ?2 AND head_sha = ?3 AND status = 'approval_required'`).bind(
    Number(repository.id), Number(payload.number), currentSha,
  ).first<{ id: string }>();
  if (!run) return null;
  await env.DB.prepare(`UPDATE rehearsal_runs SET status = 'queued', failure_reason = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?1`).bind(run.id).run();
  return run.id;
}

async function workflowRunEvent(payload: Record<string, unknown>, env: Env): Promise<string | null> {
  const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
  if (!workflowRun) return null;
  const title = String(workflowRun.display_title ?? '');
  const match = title.match(/^(?:DiffHarbor|ChangeGuard) rehearsal ([0-9a-f-]{36})$/iu);
  if (!match) return null;
  const run = await env.DB.prepare('SELECT id FROM rehearsal_runs WHERE id = ?1').bind(match[1]).first<{ id: string }>();
  if (!run) return null;
  const action = String(payload.action ?? '');
  const status = action === 'in_progress'
    ? 'running'
    : action === 'completed'
      ? (workflowRun.conclusion === 'success' ? 'completed' : 'failed')
      : null;
  if (status) {
    const reason = status === 'failed' ? `GitHub Actions concluded: ${String(workflowRun.conclusion ?? 'unknown')}` : null;
    await env.DB.prepare(`UPDATE rehearsal_runs SET status = ?1, workflow_run_id = ?2, workflow_url = ?3,
      failure_reason = COALESCE(?4, failure_reason), updated_at = CURRENT_TIMESTAMP WHERE id = ?5`).bind(
      status,
      Number.isSafeInteger(workflowRun.id) ? Number(workflowRun.id) : null,
      typeof workflowRun.html_url === 'string' ? workflowRun.html_url : null,
      reason,
      run.id,
    ).run();
  }
  return run.id;
}

async function githubWebhook(request: Request, env: Env): Promise<Response> {
  const event = request.headers.get('X-GitHub-Event');
  const delivery = request.headers.get('X-GitHub-Delivery');
  if (!event || !delivery) return json({ detail: 'GitHub event and delivery headers are required.' }, 400);
  const secret = requireEnv(env.GITHUB_WEBHOOK_SECRET, 'GitHub webhook secret');
  const bytes = await readBody(request, MAX_WEBHOOK_BYTES);
  if (bytes instanceof Response) return bytes;
  if (!await verifyWebhook(bytes, request.headers.get('X-Hub-Signature-256'), secret)) {
    return json({ detail: 'Webhook signature did not match.' }, 401);
  }
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(decodeText(bytes)) as Record<string, unknown>; }
  catch { return json({ detail: 'Webhook payload must be valid JSON.' }, 400); }
  const action = typeof payload.action === 'string' ? payload.action : null;
  const existing = await env.DB.prepare('SELECT run_id FROM webhook_deliveries WHERE delivery_id = ?1').bind(delivery).first<{ run_id: string | null }>();
  if (existing) {
    if (existing.run_id && (event === 'pull_request' || event === 'pull_request_review')) {
      const run = await env.DB.prepare('SELECT status, workflow_run_id FROM rehearsal_runs WHERE id = ?1').bind(existing.run_id).first<{ status: string; workflow_run_id: number | null }>();
      if (run?.status === 'queued' && run.workflow_run_id === null) await env.RUN_QUEUE.send({ kind: 'dispatch', run_id: existing.run_id });
    }
    return json({ accepted: true, duplicate: true, run_id: existing.run_id });
  }

  let runId: string | null = null;
  let shouldDispatch = false;
  if (event === 'installation') {
    await upsertInstallation(payload, env, !['deleted', 'suspend'].includes(action ?? ''));
  } else if (event === 'pull_request' && PULL_REQUEST_ACTIONS.has(action ?? '')) {
    const pull = payload.pull_request as Record<string, unknown> | undefined;
    const repository = payload.repository as Record<string, unknown> | undefined;
    if (pull && !pull.draft && repository?.private === false) {
      const installationId = await upsertInstallation(payload, env);
      if (!installationId) return json({ detail: 'Pull request event did not include an installation.' }, 400);
      const result = await createPullRequestRun(payload, installationId, env);
      runId = result.id;
      shouldDispatch = result.sameRepo && runId !== null;
    }
  } else if (event === 'pull_request_review' && action === 'submitted') {
    const repository = payload.repository as Record<string, unknown> | undefined;
    if (repository?.private === false && (payload.review as Record<string, unknown> | undefined)?.state === 'approved') {
      runId = await approveFork(payload, env);
      shouldDispatch = runId !== null;
    }
  } else if (event === 'workflow_run') {
    runId = await workflowRunEvent(payload, env);
  }

  await env.DB.prepare(`INSERT INTO webhook_deliveries (delivery_id, event_name, event_action, run_id)
    VALUES (?1, ?2, ?3, ?4)`).bind(delivery, event, action, runId).run();
  if (shouldDispatch && runId) await env.RUN_QUEUE.send({ kind: 'dispatch', run_id: runId });
  return json({ accepted: true, duplicate: false, run_id: runId });
}

async function githubLogin(request: Request, env: Env): Promise<Response> {
  const clientId = requireEnv(env.GITHUB_CLIENT_ID, 'GitHub OAuth client ID');
  requireEnv(env.GITHUB_CLIENT_SECRET, 'GitHub OAuth client secret');
  requireEnv(env.SESSION_SECRET, 'Session signing secret');
  encryptionKeyBytes(env);
  const appUrl = getAppUrl(env, request);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', `${appUrl}/api/auth/github/callback`);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'offline_access');
  return redirect(url.toString(), cookie('diffharbor_oauth_state', state, request, { path: '/api/auth/github/callback', maxAge: 600 }));
}

async function githubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const stateCookie = cookies(request).get('diffharbor_oauth_state');
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const clearState = expiredCookie('diffharbor_oauth_state', request, '/api/auth/github/callback');
  if (url.searchParams.has('error')) return redirect(`${getAppUrl(env, request)}/?auth_error=cancelled`, clearState);
  if (!state || !stateCookie || state !== stateCookie || !code) return json({ detail: 'GitHub sign-in state did not match.' }, 400, { 'Set-Cookie': clearState });

  const clientId = requireEnv(env.GITHUB_CLIENT_ID, 'GitHub OAuth client ID');
  const clientSecret = requireEnv(env.GITHUB_CLIENT_SECRET, 'GitHub OAuth client secret');
  const appUrl = getAppUrl(env, request);
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: `${appUrl}/api/auth/github/callback` }),
  });
  if (!tokenResponse.ok) return json({ detail: 'GitHub could not complete sign-in.' }, 401, { 'Set-Cookie': clearState });
  const tokenData = await tokenResponse.json() as Record<string, unknown>;
  const accessToken = typeof tokenData.access_token === 'string' ? tokenData.access_token : '';
  if (!accessToken) return json({ detail: 'GitHub did not return an access token.' }, 401, { 'Set-Cookie': clearState });
  const profileResponse = await apiFetch('https://api.github.com/user', accessToken);
  if (!profileResponse.ok) return json({ detail: 'GitHub could not identify this account.' }, 401, { 'Set-Cookie': clearState });
  const profile = await profileResponse.json() as Record<string, unknown>;
  if (!Number.isSafeInteger(profile.id) || typeof profile.login !== 'string') return json({ detail: 'GitHub returned an invalid account profile.' }, 401, { 'Set-Cookie': clearState });
  const userId = Number(profile.id);
  await env.DB.prepare(`INSERT INTO github_users
    (github_user_id, login, display_name, avatar_url, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(github_user_id) DO UPDATE SET login = excluded.login, display_name = excluded.display_name,
      avatar_url = excluded.avatar_url, updated_at = CURRENT_TIMESTAMP`).bind(
    userId,
    profile.login,
    typeof profile.name === 'string' ? profile.name : null,
    typeof profile.avatar_url === 'string' ? profile.avatar_url : null,
  ).run();
  await saveUserToken(userId, tokenData, env);
  const session = await signedSession(userId, env);
  const headers = new Headers({ Location: appUrl, 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearState);
  headers.append('Set-Cookie', cookie('diffharbor_session', session, request, { maxAge: 8 * 60 * 60 }));
  return new Response(null, { status: 302, headers });
}

async function logout(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ detail: 'Request origin did not match.' }, 403);
  const userId = await sessionUserId(request, env);
  if (userId) {
    const user = await getUser(userId, env);
    if (user?.access_token_ciphertext && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
      try {
        const token = await decryptToken(user.access_token_ciphertext, env);
        const basic = btoa(`${env.GITHUB_CLIENT_ID}:${env.GITHUB_CLIENT_SECRET}`);
        await fetch(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_CLIENT_ID)}/grant`, {
          method: 'DELETE',
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token: token }),
        });
      } catch { /* Local sign-out still clears the encrypted token. */ }
    }
    await env.DB.prepare(`UPDATE github_users SET access_token_ciphertext = NULL, refresh_token_ciphertext = NULL,
      access_token_expires_at = NULL, refresh_token_expires_at = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE github_user_id = ?1`).bind(userId).run();
  }
  return json({ signed_out: true }, 200, { 'Set-Cookie': expiredCookie('diffharbor_session', request) });
}

async function runList(request: Request, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (!userId) return json({ detail: 'Sign in with GitHub to continue.' }, 401);
  const user = await getUser(userId, env);
  if (!user) return json({ detail: 'Sign in with GitHub to continue.' }, 401);
  const ids = await accessiblePublicRepositories(user, env);
  const rows: RunRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const group = ids.slice(offset, offset + 80);
    if (!group.length) continue;
    const placeholders = group.map((_, index) => `?${index + 1}`).join(', ');
    const result = await env.DB.prepare(`SELECT * FROM rehearsal_runs WHERE repository_id IN (${placeholders})
      ORDER BY created_at DESC LIMIT 50`).bind(...group).all<RunRow>();
    rows.push(...result.results);
  }
  rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
  return json(rows.slice(0, 50).map(publicRun));
}

async function runDetail(request: Request, runId: string, env: Env): Promise<Response> {
  const userId = await sessionUserId(request, env);
  if (!userId) return json({ detail: 'Sign in with GitHub to continue.' }, 401);
  const user = await getUser(userId, env);
  if (!user) return json({ detail: 'Sign in with GitHub to continue.' }, 401);
  const ids = await accessiblePublicRepositories(user, env);
  if (!ids.length) return json({ detail: 'Rehearsal run was not found.' }, 404);
  const run = await env.DB.prepare('SELECT * FROM rehearsal_runs WHERE id = ?1').bind(runId).first<RunRow>();
  if (!run || !ids.includes(run.repository_id)) return json({ detail: 'Rehearsal run was not found.' }, 404);
  const findingRows = await env.DB.prepare(`SELECT id, category, severity, confidence, title, description,
    file_path, line_start, evidence FROM findings WHERE run_id = ?1 ORDER BY severity, created_at`).bind(run.id).all<Record<string, unknown>>();
  const findings = findingRows.results.map((finding) => ({ ...finding, evidence: safeJson(String(finding.evidence ?? '{}'), {}) }));
  return json({ ...publicRun(run), findings });
}

async function routeApi(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/u, '') || '/';
  const method = request.method.toUpperCase();

  if (method === 'GET' && path === '/api/health') return json({ status: 'ok', service: 'diffharbor-api' });
  if (method === 'GET' && path === '/api/github/status') {
    const configured = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_SLUG && env.GITHUB_APP_PRIVATE_KEY && env.GITHUB_WEBHOOK_SECRET && env.APP_PUBLIC_URL);
    return json({ configured, installation_url: env.GITHUB_APP_SLUG ? `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new` : null, provider: 'github', repository_policy: 'public_only' });
  }
  if (method === 'GET' && path === '/api/auth/status') {
    const configured = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET && env.AUTH_TOKEN_ENCRYPTION_KEY && env.APP_PUBLIC_URL);
    return json({ configured });
  }
  if (method === 'GET' && path === '/api/auth/github/login') {
    try { return await githubLogin(request, env); }
    catch { return json({ detail: 'GitHub sign-in is not configured.' }, 503); }
  }
  if (method === 'GET' && path === '/api/auth/github/callback') {
    try { return await githubCallback(request, env); }
    catch { return json({ detail: 'GitHub could not complete sign-in. Check the OAuth callback URL and app secrets.' }, 503); }
  }
  if (method === 'GET' && path === '/api/auth/me') {
    const id = await sessionUserId(request, env);
    if (!id) return json({ detail: 'Sign in with GitHub to continue.' }, 401);
    const user = await getUser(id, env);
    if (!user) return json({ detail: 'Sign in with GitHub to continue.' }, 401, { 'Set-Cookie': expiredCookie('diffharbor_session', request) });
    return json({ id: user.github_user_id, login: user.login, name: user.display_name, avatar_url: user.avatar_url });
  }
  if (method === 'POST' && path === '/api/auth/logout') return logout(request, env);
  if (method === 'GET' && path === '/api/runs') {
    try { return await runList(request, env); }
    catch { return json({ detail: 'Could not load public repository runs. Sign in again if your GitHub session expired.' }, 503); }
  }
  if (method === 'POST' && path === '/api/github/webhook') {
    try { return await githubWebhook(request, env); }
    catch { return json({ detail: 'GitHub webhook could not be processed.' }, 503); }
  }
  const reportMatch = path.match(/^\/api\/runs\/([0-9a-f-]{36})\/report$/iu);
  if (method === 'POST' && reportMatch) {
    try { return await acceptReport(request, reportMatch[1], env); }
    catch { return json({ detail: 'GitHub Actions report could not be verified or saved.' }, 503); }
  }
  const detailMatch = path.match(/^\/api\/runs\/([0-9a-f-]{36})$/iu);
  if (method === 'GET' && detailMatch) {
    try { return await runDetail(request, detailMatch[1], env); }
    catch { return json({ detail: 'Could not load rehearsal evidence. Sign in again if your GitHub session expired.' }, 503); }
  }
  return null;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeApi(request, env);
    if (response) return response;
    return env.ASSETS.fetch(request);
  },

  async queue(batch: QueueBatch<{ kind?: string; run_id?: string }>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        if (message.body.kind === 'dispatch' && typeof message.body.run_id === 'string') {
          await dispatchRun(message.body.run_id, env);
        }
        message.ack();
      } catch {
        if (message.attempts < 3) message.retry({ delaySeconds: 30 });
        else {
          const runId = message.body.run_id;
          if (runId) {
            await env.DB.prepare(`UPDATE rehearsal_runs SET status = 'failed', failure_reason = 'GitHub workflow dispatch could not be completed after retries.',
              updated_at = CURRENT_TIMESTAMP WHERE id = ?1 AND status IN ('queued', 'dispatching')`).bind(runId).run();
          }
          message.ack();
        }
      }
    }
  },
};

export default worker;
