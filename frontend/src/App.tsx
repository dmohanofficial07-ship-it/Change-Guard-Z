import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, GitPullRequest, LogOut, ShieldCheck, Waypoints } from 'lucide-react';

type GitHubStatus = {
  configured: boolean;
  installation_url: string | null;
  provider: string;
};

type AuthStatus = { configured: boolean };
type User = { id: number; login: string; name: string | null; avatar_url: string | null };
type Run = {
  id: string;
  repository_owner: string;
  repository_name: string;
  pull_request_number: number;
  pull_request_title: string;
  status: string;
  workflow_url: string | null;
  created_at: string;
};
type CheckResult = {
  name: string;
  status: string;
  exit_code: number | null;
  duration_seconds: number;
  output_excerpt: string;
};
type CheckComparison = { name: string; baseline: CheckResult; candidate: CheckResult };
type ImpactRoute = { method: string; path: string; function: string; file_path: string; line_start: number };
type Impact = {
  changed_files?: string[];
  affected_files?: string[];
  routes?: ImpactRoute[];
  parse_errors?: { file_path: string; line_start: number; message: string }[];
  confidence?: string;
};
type Finding = {
  id: string;
  category: string;
  severity: string;
  confidence: number;
  title: string;
  description: string;
  file_path: string | null;
  line_start: number | null;
  evidence: Record<string, unknown>;
};
type RunDetail = Run & { check_results: CheckComparison[]; impact: Impact; findings: Finding[] };

function App() {
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setUser(null);
      setRuns([]);
      setSelectedRunId(null);
      setRunDetail(null);
    }
  };

  useEffect(() => {
    fetch('/api/github/status')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('API unavailable'))))
      .then((data: GitHubStatus) => setGithubStatus(data))
      .catch(() => setGithubStatus(null));

    fetch('/api/auth/status')
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('API unavailable'))))
      .then((data: AuthStatus) => setAuthStatus(data))
      .catch(() => setAuthStatus(null));

    fetch('/api/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: User | null) => {
        setUser(data);
        if (!data) return;
        setLoadingRuns(true);
        fetch('/api/runs')
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Could not load runs'))))
          .then((data: Run[]) => {
            setRuns(data);
            setSelectedRunId(data[0]?.id ?? null);
          })
          .catch(() => setRuns([]))
          .finally(() => setLoadingRuns(false));
      })
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setLoadingDetail(true);
    setDetailError(null);
    fetch(`/api/runs/${selectedRunId}`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('Could not load rehearsal evidence'))))
      .then((data: RunDetail) => setRunDetail(data))
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setDetailError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDetail(false);
      });
    return () => controller.abort();
  }, [selectedRunId]);

  const installationUrl = githubStatus?.configured ? githubStatus.installation_url ?? undefined : undefined;
  const signInUrl = authStatus?.configured ? '/api/auth/github/login' : undefined;
  const setupSteps = user
    ? ['Install the ChangeGuard GitHub App', 'Open a pull request in a Python backend repository', 'Review the rehearsal status and evidence']
    : ['Sign in with GitHub', 'Install ChangeGuard for a repository', 'Open a pull request to start a rehearsal'];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="ChangeGuard home">
          <span className="brand-mark"><ShieldCheck size={18} strokeWidth={2.3} /></span>
          <span>changeguard</span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switcher" type="button">
          <span className="workspace-avatar">W</span>
          <span className="workspace-name">Your workspace</span>
          <span className="switcher-chevron">⌄</span>
        </button>

        <nav className="primary-nav" aria-label="Main navigation">
          <a className="nav-item active" href="#pull-requests"><GitPullRequest size={17} /> Pull requests</a>
          <a className="nav-item" href="#impact"><Waypoints size={17} /> Impact analysis</a>
          <a className="nav-item" href="#activity"><Activity size={17} /> Activity</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-status"><span className="status-dot" /> {user ? `Signed in as @${user.login}` : 'GitHub sign-in needed'}</div>
          <div className="profile-row">
            {user?.avatar_url ? <img className="profile-avatar" src={user.avatar_url} alt="" /> : <div className="profile-avatar">{user?.login?.slice(0, 1).toUpperCase() ?? 'G'}</div>}
            <div className="profile-copy"><strong>{user?.name || user?.login || 'GitHub user'}</strong><span>{user ? 'GitHub account' : 'Sign in to continue'}</span></div>
            {user && <button className="profile-menu" type="button" onClick={signOut} aria-label="Sign out of GitHub" title="Sign out"><LogOut size={14} /></button>}
          </div>
        </div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><span className="crumb-divider">/</span><strong>Pull requests</strong></div>
          <div className="topbar-right"><span className="environment-pill"><span className="status-dot" /> {user ? 'GitHub connected' : signInUrl ? 'Sign in required' : 'Setup required'}</span><button className="help-button" type="button" aria-label="Help">?</button></div>
        </header>

        <section className="page-content" id="pull-requests">
          <div className="eyebrow"><span className="eyebrow-line" /> CHANGE REHEARSAL</div>
          <div className="page-heading-row">
            <div>
              <h1>Pull requests</h1>
              <p className="page-intro">See what a change might affect before it reaches production.</p>
            </div>
            {user && installationUrl ? (
              <a className="primary-button" href={installationUrl} target="_blank" rel="noreferrer">
                <GitPullRequest size={16} /> Install GitHub App <ArrowUpRight size={15} />
              </a>
            ) : !user && signInUrl ? (
              <a className="primary-button" href={signInUrl}><GitPullRequest size={16} /> Sign in with GitHub <ArrowUpRight size={15} /></a>
            ) : (
              <button className="primary-button" type="button" disabled>
                <GitPullRequest size={16} /> {user ? 'Configure GitHub App' : 'Configure GitHub sign-in'} <ArrowUpRight size={15} />
              </button>
            )}
          </div>

          <section className="setup-card" aria-labelledby="setup-title">
            <div className="setup-card-main">
              <div className="setup-icon"><GitPullRequest size={19} /></div>
              <div className="setup-copy">
                <div className="setup-kicker">FIRST CONNECTION</div>
                <h2 id="setup-title">{user ? 'Connect a repository to begin' : 'Sign in to connect your repositories'}</h2>
                <p>ChangeGuard will compare a pull request with its base branch, map affected Python backend code, and run the approved checks on a temporary GitHub Actions runner.</p>
                <ol className="setup-steps">
                  {setupSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}
                </ol>
                {user && installationUrl ? (
                  <a className="secondary-button" href={installationUrl} target="_blank" rel="noreferrer">Install on GitHub <ArrowUpRight size={15} /></a>
                ) : !user && signInUrl ? (
                  <a className="secondary-button" href={signInUrl}>Sign in with GitHub <ArrowUpRight size={15} /></a>
                ) : (
                  <a className="secondary-button" href="#github-setup">Set up GitHub App credentials <ArrowUpRight size={15} /></a>
                )}
              </div>
            </div>
            <div className="setup-card-note"><span className="note-shield"><ShieldCheck size={16} /></span><span>Analysis runs in the repository’s CI environment. ChangeGuard reports evidence; your team makes the release decision.</span></div>
          </section>

          <div className="below-grid">
            <section className="empty-panel" id="impact">
              <div className="panel-heading"><div><h3>Impact analysis</h3><p>{runDetail ? `${runDetail.repository_owner}/${runDetail.repository_name} · PR #${runDetail.pull_request_number}` : 'Code paths connected to a proposed change'}</p></div><Waypoints size={18} /></div>
              {loadingDetail ? (
                <div className="empty-state"><strong>Loading impact evidence</strong></div>
              ) : runDetail ? (
                <div className="impact-content">
                  <div className="impact-stats">
                    <div><strong>{runDetail.impact.changed_files?.length ?? 0}</strong><span>Changed files</span></div>
                    <div><strong>{runDetail.impact.affected_files?.length ?? 0}</strong><span>Affected files</span></div>
                    <div><strong>{runDetail.impact.routes?.length ?? 0}</strong><span>Routes found</span></div>
                  </div>
                  <div className="impact-columns">
                    <div className="impact-list"><h4>Affected Python files</h4>
                      {runDetail.impact.affected_files?.length ? runDetail.impact.affected_files.slice(0, 8).map((path) => <div className="impact-path" key={path}>{path}</div>) : <span className="subtle-text">No affected Python files were mapped.</span>}
                    </div>
                    <div className="impact-list"><h4>API routes</h4>
                      {runDetail.impact.routes?.length ? runDetail.impact.routes.slice(0, 6).map((route) => <div className="route-item" key={`${route.file_path}:${route.line_start}:${route.method}:${route.path}`}><strong>{route.method} {route.path}</strong><span>{route.file_path}:{route.line_start} · {route.function}</span></div>) : <span className="subtle-text">No decorator based routes were found.</span>}
                    </div>
                  </div>
                  {runDetail.impact.parse_errors?.length ? <p className="parse-note">{runDetail.impact.parse_errors.length} Python file(s) could not be parsed; the map may be incomplete.</p> : null}
                  {runDetail.workflow_url ? <a className="actions-link" href={runDetail.workflow_url} target="_blank" rel="noreferrer">View GitHub Actions run <ArrowUpRight size={13} /></a> : null}
                </div>
              ) : (
                <div className="empty-state"><div className="empty-state-icon"><Waypoints size={19} /></div><strong>{detailError || (user ? 'No run selected yet' : 'Sign in to see impact maps')}</strong><span>{user ? 'Open a pull request in an installed repository to create the first rehearsal.' : 'ChangeGuard traces changed Python modules to affected files and API routes.'}</span></div>
              )}
            </section>
            <section className="empty-panel evidence-panel">
              <div className="panel-heading"><div><h3>Run evidence</h3><p>Baseline compared with the pull request candidate</p></div><ShieldCheck size={18} /></div>
              {loadingDetail ? (
                <div className="empty-state"><strong>Loading check results</strong></div>
              ) : runDetail ? (
                <div className="evidence-content">
                  {runDetail.findings.length ? <div className="finding-list">{runDetail.findings.slice(0, 4).map((finding) => <article className="finding-row" key={finding.id}><div><span className={`severity-pill severity-${finding.severity}`}>{finding.severity}</span><strong>{finding.title}</strong></div><p>{finding.description}{finding.file_path ? ` · ${finding.file_path}${finding.line_start ? `:${finding.line_start}` : ''}` : ''}</p></article>)}</div> : <div className="no-findings">No differences were reported by the configured checks.</div>}
                  {runDetail.check_results.length ? <div className="check-list"><div className="check-head"><span>Check</span><span>Base</span><span>Candidate</span></div>{runDetail.check_results.map((check, index) => <details className="check-item" key={`${check.name}-${index}`}><summary><span>{check.name}</span><span className={`check-status check-${check.baseline.status}`}>{check.baseline.status.replaceAll('_', ' ')}</span><span className={`check-status check-${check.candidate.status}`}>{check.candidate.status.replaceAll('_', ' ')}</span></summary><div className="check-logs"><div><strong>Base output</strong><pre>{check.baseline.output_excerpt || 'No output captured.'}</pre></div><div><strong>Candidate output</strong><pre>{check.candidate.output_excerpt || 'No output captured.'}</pre></div></div></details>)}</div> : <div className="no-findings">No checks have been attached to this run yet.</div>}
                </div>
              ) : (
                <div className="empty-state"><div className="empty-state-icon"><ShieldCheck size={19} /></div><strong>{detailError || 'Evidence appears when a run finishes'}</strong><span>The check report compares the same configured commands on the base and candidate commits.</span></div>
              )}
            </section>
            <section className="empty-panel activity-panel" id="activity">
              <div className="panel-heading"><div><h3>Recent activity</h3><p>Rehearsal runs across your workspace</p></div><Activity size={18} /></div>
              {runs.length ? (
                <div className="run-list">
                  {runs.slice(0, 5).map((run) => (
                    <button className={`run-row ${selectedRunId === run.id ? 'run-row-selected' : ''}`} onClick={() => setSelectedRunId(run.id)} type="button" key={run.id} aria-pressed={selectedRunId === run.id}>
                      <span className={`run-status status-${run.status}`} />
                      <span className="run-copy"><strong>{run.repository_owner}/{run.repository_name} · #{run.pull_request_number}</strong><span>{run.pull_request_title}</span></span>
                      <span className="run-state">{run.status.replaceAll('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><div className="empty-state-icon"><Activity size={19} /></div><strong>{loadingRuns ? 'Loading rehearsal runs' : user ? 'No rehearsal runs yet' : 'Sign in to view activity'}</strong><span>{user ? 'Each run records the commit pair, checks, and evidence for review.' : 'Activity is limited to GitHub installations you can access.'}</span></div>
              )}
            </section>
          </div>
          <footer className="page-footer" id="github-setup"><span>ChangeGuard</span><span>Evidence before release</span><span>v0.1 preview</span></footer>
        </section>
      </main>
    </div>
  );
}

export default App;
