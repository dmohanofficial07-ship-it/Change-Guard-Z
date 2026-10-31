import { useEffect, useState } from 'react';
import { Activity, ArrowUpRight, BookOpen, CircleHelp, GitPullRequest, LogOut, Moon, ShieldCheck, Sun, Waypoints } from 'lucide-react';
import TuliExplainer from './TuliExplainer';

type GitHubStatus = {
  configured: boolean;
  installation_url: string | null;
  provider: string;
  repository_policy?: string;
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
type CheckComparisonKind = 'new_failure' | 'pre_existing_failure' | 'fixed' | 'passing' | 'inconclusive';
type CheckInsight = { kind: CheckComparisonKind; label: string; explanation: string };
type CheckSummary = { title: string; description: string; tone: 'danger' | 'warning' | 'success' };
type PageName = 'pull-requests' | 'impact' | 'activity' | 'help' | 'run-detail';
type ThemeName = 'light' | 'dark';

const README_JUDGE_GUIDE_URL = 'https://github.com/dmohanofficial07-ship-it/Change-Guard-Z/blob/main/docs/judge-guide.md';
const SETUP_GUIDE_URL = 'https://github.com/dmohanofficial07-ship-it/Change-Guard-Z/blob/main/docs/live-service-setup.md';

function readRoute(pathname: string): { demo: boolean; page: PageName; runId: string | null } {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const demo = normalized === '/demo' || normalized.startsWith('/demo/');
  const route = demo ? normalized.replace(/^\/demo/, '') || '/' : normalized;
  const runMatch = route.match(/^\/runs\/([^/]+)$/);
  if (runMatch) return { demo, page: 'run-detail', runId: decodeURIComponent(runMatch[1]) };
  if (route === '/impact') return { demo, page: 'impact', runId: null };
  if (route === '/activity') return { demo, page: 'activity', runId: null };
  if (route === '/help') return { demo, page: 'help', runId: null };
  return { demo, page: 'pull-requests', runId: null };
}

function pageHref(demoMode: boolean, page: PageName, runId?: string): string {
  const prefix = demoMode ? '/demo' : '';
  if (page === 'pull-requests') return prefix || '/';
  if (page === 'run-detail') return `${prefix}/runs/${encodeURIComponent(runId ?? '')}`;
  return `${prefix}/${page}`;
}

function getCheckInsight(check: CheckComparison): CheckInsight {
  const baseline = String(check.baseline?.status ?? '').toLowerCase();
  const candidate = String(check.candidate?.status ?? '').toLowerCase();

  if (!['passed', 'failed'].includes(baseline) || !['passed', 'failed'].includes(candidate)) {
    return {
      kind: 'inconclusive',
      label: 'Not enough evidence',
      explanation: `The comparison is incomplete: base is ${baseline || 'unknown'} and candidate is ${candidate || 'unknown'}.`,
    };
  }
  if (baseline === 'passed' && candidate === 'failed') {
    return { kind: 'new_failure', label: 'New failure', explanation: 'Passed on base; failed on the proposed change.' };
  }
  if (baseline === 'failed' && candidate === 'passed') {
    return { kind: 'fixed', label: 'Fixed by change', explanation: 'Failed on base; passed on the proposed change.' };
  }
  if (baseline === 'failed' && candidate === 'failed') {
    return { kind: 'pre_existing_failure', label: 'Already failing', explanation: 'Failed on both versions; this change did not clear it.' };
  }
  return { kind: 'passing', label: 'Passing on both', explanation: 'Passed on both base and the proposed change.' };
}

function summarizeChecks(checks: CheckComparison[]): CheckSummary | null {
  if (!checks.length) return null;

  const counts: Record<CheckComparisonKind, number> = {
    new_failure: 0,
    pre_existing_failure: 0,
    fixed: 0,
    passing: 0,
    inconclusive: 0,
  };
  checks.forEach((check) => { counts[getCheckInsight(check).kind] += 1; });

  const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  let title: string;
  if (counts.new_failure) title = `${countLabel(counts.new_failure, 'new failure')} on proposed change`;
  else if (counts.inconclusive) title = `${countLabel(counts.inconclusive, 'check')} ${counts.inconclusive === 1 ? 'needs' : 'need'} another look`;
  else if (counts.pre_existing_failure) title = `${countLabel(counts.pre_existing_failure, 'failure')} already on base`;
  else if (counts.fixed) title = `The change fixes ${countLabel(counts.fixed, 'check')}`;
  else title = 'All configured checks pass';

  const details: string[] = [];
  if (counts.new_failure) details.push(`${countLabel(counts.new_failure, 'check')} passed on base but failed on the proposed change. Review candidate output before merging.`);
  if (counts.pre_existing_failure) details.push(`${countLabel(counts.pre_existing_failure, 'check')} ${counts.pre_existing_failure === 1 ? 'fails' : 'fail'} on both versions, so they do not appear new in this change.`);
  if (counts.fixed) details.push(`${countLabel(counts.fixed, 'check')} failed on base and passed on the proposed change.`);
  if (counts.passing) {
    details.push(counts.new_failure || counts.pre_existing_failure || counts.fixed
      ? `${countLabel(counts.passing, 'check')} passed on both versions.`
      : 'Every check passed on both the base version and the proposed change.');
  }
  if (counts.inconclusive) details.push(`Evidence is incomplete for ${countLabel(counts.inconclusive, 'check')}: ${counts.inconclusive === 1 ? 'it timed out, was skipped, or returned' : 'they timed out, were skipped, or returned'} an unknown status.`);

  return {
    title,
    description: details.join(' '),
    tone: counts.new_failure ? 'danger' : counts.inconclusive || counts.pre_existing_failure ? 'warning' : 'success',
  };
}

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

const DEMO_PR_URL = 'https://github.com/dmohanofficial07-ship-it/northstar-mule-intelligence/pull/2';

function sampleCheck(name: string, failed = false): CheckComparison {
  const baseline: CheckResult = {
    name,
    status: 'passed',
    exit_code: 0,
    duration_seconds: 1.2,
    output_excerpt: name === 'Backend tests' ? '3 passed' : 'Passed.',
  };
  const candidate: CheckResult = {
    name,
    status: failed ? 'failed' : 'passed',
    exit_code: failed ? 1 : 0,
    duration_seconds: 1.4,
    output_excerpt: failed
      ? 'FAILED test_risk_engine.py::test_coordinated_mule_signals_create_critical_score\nAssertionError: expected 100, received 111'
      : name === 'Backend tests' ? '3 passed' : 'Passed.',
  };
  return { name, baseline, candidate };
}

function sampleRun(failed: boolean): RunDetail {
  const id = failed ? 'sample-failed' : 'sample-fixed';
  return {
    id,
    repository_owner: 'example-team',
    repository_name: 'payments-api',
    pull_request_number: 18,
    pull_request_title: failed ? 'Risk score can exceed 100' : 'Restore the risk score limit',
    status: failed ? 'failed' : 'passed',
    workflow_url: null,
    created_at: '2026-10-30T00:00:00Z',
    check_results: [
      sampleCheck('Install dependencies'),
      sampleCheck('Ruff backend lint'),
      sampleCheck('Backend tests', failed),
      sampleCheck('Python compile'),
      sampleCheck('Container image build'),
    ],
    impact: {
      changed_files: ['backend/app/services/risk_engine.py'],
      affected_files: ['backend/app/services/risk_engine.py', 'backend/app/routers/transactions.py'],
      routes: [{
        method: 'POST',
        path: '/api/transactions/screen',
        function: 'screen_transaction',
        file_path: 'backend/app/routers/transactions.py',
        line_start: 34,
      }],
      confidence: 'high',
    },
    findings: failed ? [{
      id: 'sample-score-cap',
      category: 'check_failure',
      severity: 'high',
      confidence: 1,
      title: 'Backend test found a score above the limit',
      description: 'The configured test expected a maximum score of 100 but received 111.',
      file_path: 'backend/app/services/risk_engine.py',
      line_start: 50,
      evidence: { expected: 100, received: 111 },
    }] : [],
  };
}

const DEMO_DETAILS: Record<string, RunDetail> = {
  'sample-failed': sampleRun(true),
  'sample-fixed': sampleRun(false),
};
const DEMO_RUNS: Run[] = [DEMO_DETAILS['sample-failed'], DEMO_DETAILS['sample-fixed']].map(
  ({ id, repository_owner, repository_name, pull_request_number, pull_request_title, status, workflow_url, created_at }) => ({
    id, repository_owner, repository_name, pull_request_number, pull_request_title, status, workflow_url, created_at,
  }),
);

function App() {
  const route = readRoute(window.location.pathname);
  const demoMode = import.meta.env.VITE_PUBLIC_DEMO === 'true' || route.demo;
  const page = route.page;
  const [theme, setTheme] = useState<ThemeName>(() => {
    try {
      const saved = localStorage.getItem('diffharbor-theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch { /* Use the system theme if browser storage is unavailable. */ }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(route.runId);
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem('diffharbor-theme', theme); } catch { /* Keep the current selection for this session. */ }
  }, [theme]);

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
    if (demoMode) {
      setRuns(DEMO_RUNS);
      setSelectedRunId(route.runId ?? 'sample-failed');
      return;
    }

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
            setSelectedRunId(route.runId ?? data[0]?.id ?? null);
          })
          .catch(() => setRuns([]))
          .finally(() => setLoadingRuns(false));
      })
      .catch(() => setUser(null));
  }, [demoMode]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      setDetailError(null);
      return;
    }
    if (demoMode) {
      setRunDetail(DEMO_DETAILS[selectedRunId] ?? null);
      setLoadingDetail(false);
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
  }, [selectedRunId, demoMode]);

  const installationUrl = githubStatus?.configured ? githubStatus.installation_url ?? undefined : undefined;
  const signInUrl = authStatus?.configured ? '/api/auth/github/login' : undefined;
  const setupSteps = demoMode
    ? ['Choose a sample pull request', 'Review changed Python files and routes', 'Compare the checks before and after the fix']
    : user
    ? ['Install the GitHub App on a public repository', 'Add the workflow and check config to its default branch', 'Open a pull request and review the evidence']
    : ['Sign in with GitHub', 'Install the GitHub App on a public repository', 'Add the setup files, then open a pull request'];
  const checkSummary = runDetail ? summarizeChecks(runDetail.check_results) : null;
  const pageTitle = page === 'pull-requests'
    ? demoMode ? 'Try a sample rehearsal' : 'Pull requests'
    : page === 'impact' ? 'Impact analysis'
    : page === 'activity' ? 'Activity'
    : page === 'help' ? 'Help & FAQ'
    : 'Rehearsal details';
  const pageDescription = page === 'pull-requests'
    ? demoMode
      ? 'DiffHarbor maps what a code change may affect, then compares checks on the current and proposed versions. Select a sample run to explore the failure and fix.'
      : 'Review proposed changes, affected Python code, and check results before deciding whether to merge.'
    : page === 'impact' ? 'See which Python files and API routes may be affected by the selected change.'
    : page === 'activity' ? 'Browse rehearsal runs and open any run to review its evidence.'
    : page === 'help' ? 'A short guide to the dashboard, followed by answers to common questions.'
    : 'Compare the changed code paths and check results for this pull request.';

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="sidebar">
        <a className="brand" href={pageHref(demoMode, 'pull-requests')} aria-label="DiffHarbor home">
          <span className="brand-mark"><ShieldCheck size={18} strokeWidth={2.3} /></span>
          <span>diffharbor</span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher" title={demoMode ? 'Fictional sample workspace' : user ? `GitHub workspace for @${user.login}` : 'Sign in with GitHub to connect a workspace'}>
          <span className="workspace-avatar">{demoMode ? 'S' : user?.login?.slice(0, 1).toUpperCase() ?? 'G'}</span>
          <span className="workspace-name">{demoMode ? 'Sample workspace' : user ? `@${user.login}` : 'GitHub workspace'}</span>
          <span className="workspace-mode">{demoMode ? 'DEMO' : user ? 'CONNECTED' : 'GITHUB'}</span>
        </div>

        <nav className="primary-nav" aria-label="Main navigation">
          <a className={`nav-item ${page === 'pull-requests' ? 'active' : ''}`} href={pageHref(demoMode, 'pull-requests')} aria-current={page === 'pull-requests' ? 'page' : undefined}><GitPullRequest size={17} /> Pull requests</a>
          <a className={`nav-item ${page === 'impact' ? 'active' : ''}`} href={pageHref(demoMode, 'impact')} aria-current={page === 'impact' ? 'page' : undefined}><Waypoints size={17} /> Impact analysis</a>
          <a className={`nav-item ${page === 'activity' || page === 'run-detail' ? 'active' : ''}`} href={pageHref(demoMode, 'activity')} aria-current={page === 'activity' || page === 'run-detail' ? 'page' : undefined}><Activity size={17} /> Activity</a>
          <a className={`nav-item ${page === 'help' ? 'active' : ''}`} href={pageHref(demoMode, 'help')} aria-current={page === 'help' ? 'page' : undefined}><CircleHelp size={17} /> Help & FAQ</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-status"><span className="status-dot" /> {demoMode ? 'Public sample · read-only' : user ? `Signed in as @${user.login}` : 'GitHub sign-in needed'}</div>
          <div className="profile-row">
            {demoMode ? <div className="profile-avatar">S</div> : user?.avatar_url ? <img className="profile-avatar" src={user.avatar_url} alt="" /> : <div className="profile-avatar">{user?.login?.slice(0, 1).toUpperCase() ?? 'G'}</div>}
            <div className="profile-copy"><strong>{demoMode ? 'Sample workspace' : user?.name || user?.login || 'GitHub user'}</strong><span>{demoMode ? 'Fictional sample data' : user ? 'GitHub account' : 'Sign in to continue'}</span></div>
            {user && <button className="profile-menu" type="button" onClick={signOut} aria-label="Sign out of GitHub" title="Sign out"><LogOut size={14} /></button>}
          </div>
        </div>
      </aside>

      <main className="main-content" id="home">
        <header className="topbar">
          <div className="breadcrumbs"><span>{demoMode ? 'Sample workspace' : 'Workspace'}</span><span className="crumb-divider">/</span><strong>{pageTitle}</strong></div>
          <div className="topbar-right"><span className={`environment-pill ${demoMode ? 'demo-indicator' : ''}`}><span className="status-dot" /> {demoMode ? 'Read-only sample' : user ? 'GitHub connected' : signInUrl ? 'Sign in required' : 'Setup required'}</span><button className="theme-toggle" type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button><a className="help-button" href={pageHref(demoMode, 'help')} aria-label="Open Help and FAQ" title="Open Help & FAQ"><CircleHelp size={16} /></a></div>
        </header>

        <section className={`page-content page-${page}`}>
          <div className="eyebrow"><span className="eyebrow-line" /> {page === 'pull-requests' ? 'CHANGE REHEARSAL' : page === 'run-detail' ? 'RUN REPORT' : pageTitle.toUpperCase()}</div>
          <div className="page-heading-row">
            <div>
              <h1 className={demoMode && page === 'pull-requests' ? 'compact-page-title' : undefined}>{pageTitle}</h1>
              <p className="page-intro">{pageDescription}</p>
            </div>
            {page === 'pull-requests' && (demoMode ? (
              <a className="primary-button" href={DEMO_PR_URL} target="_blank" rel="noreferrer">
                <GitPullRequest size={16} /> View real demo PR <ArrowUpRight size={15} />
              </a>
            ) : user && installationUrl ? (
              <a className="primary-button" href={installationUrl} target="_blank" rel="noreferrer">
                <GitPullRequest size={16} /> Install GitHub App <ArrowUpRight size={15} />
              </a>
            ) : !user && signInUrl ? (
              <a className="primary-button" href={signInUrl}><GitPullRequest size={16} /> Sign in with GitHub <ArrowUpRight size={15} /></a>
            ) : (
              <a className="primary-button" href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">
                <GitPullRequest size={16} /> View setup guide <ArrowUpRight size={15} />
              </a>
            ))}
            {page === 'run-detail' && <a className="secondary-button" href={pageHref(demoMode, 'activity')}>Back to activity</a>}
          </div>

          {page === 'pull-requests' && <section className="setup-card" aria-labelledby="setup-title">
            <div className="setup-card-main">
              <div className="setup-icon"><GitPullRequest size={19} /></div>
              <div className="setup-copy">
                <div className="setup-kicker">{demoMode ? 'PUBLIC READ-ONLY DEMO' : 'FIRST CONNECTION'}</div>
                <h2 id="setup-title">{demoMode ? 'Explore a sample failure and fix' : user ? 'Connect a repository to begin' : 'Sign in to connect your repositories'}</h2>
                <p>{demoMode ? 'These examples use fictional results. Select either run under Recent activity to compare the failed change with its fix. This page does not read GitHub accounts, repositories, or saved runs.' : 'Connect a public GitHub repository, then add changeguard.toml and .github/workflows/changeguard.yml to its default branch. DiffHarbor compares configured checks on the base and proposed change. Python repositories also get a Python impact map; other languages need custom workflow runtime setup and get check comparisons only. Private repositories are not run in the no-cost setup.'}</p>
                <ol className="setup-steps">
                  {setupSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, '0')}</span>{step}</li>)}
                </ol>
                {demoMode ? (
                  <a className="secondary-button" href={DEMO_PR_URL} target="_blank" rel="noreferrer">See the real GitHub example <ArrowUpRight size={15} /></a>
                ) : user && installationUrl ? (
                  <a className="secondary-button" href={installationUrl} target="_blank" rel="noreferrer">Install on GitHub <ArrowUpRight size={15} /></a>
                ) : !user && signInUrl ? (
                  <a className="secondary-button" href={signInUrl}>Sign in with GitHub <ArrowUpRight size={15} /></a>
                ) : (
                  <a className="secondary-button" href={SETUP_GUIDE_URL} target="_blank" rel="noreferrer">Read the GitHub setup guide <ArrowUpRight size={15} /></a>
                )}
                {!demoMode && <a className="setup-files-link" href="https://github.com/dmohanofficial07-ship-it/Change-Guard-Z/tree/main/integrations/github/templates" target="_blank" rel="noreferrer">View the workflow and config templates <ArrowUpRight size={14} /></a>}
              </div>
            </div>
            <div className="setup-card-note"><span className="note-shield"><ShieldCheck size={16} /></span><span>{demoMode ? 'Sample mode is read-only. It does not connect to GitHub or expose any real project data.' : 'Analysis runs in the repository’s CI environment. DiffHarbor reports evidence; your team makes the release decision.'}</span></div>
          </section>}

          <div className={`below-grid view-${page}`}>
            {page === 'help' && <section className="empty-panel help-center">
              <div className="panel-heading"><div><h3>Dashboard navigation</h3><p>Choose a section to see the matching part of a rehearsal.</p></div><BookOpen size={18} /></div>
              <TuliExplainer />
              <div className="help-content">
                <div className="help-guide">
                  <a href={pageHref(demoMode, 'pull-requests')}><GitPullRequest size={17} /><span><strong>Pull requests</strong><small>Start a sample rehearsal or connect a repository.</small></span><ArrowUpRight size={15} /></a>
                  <a href={pageHref(demoMode, 'impact')}><Waypoints size={17} /><span><strong>Impact analysis</strong><small>Review affected Python files and API routes.</small></span><ArrowUpRight size={15} /></a>
                  <a href={pageHref(demoMode, 'activity')}><Activity size={17} /><span><strong>Activity</strong><small>Browse runs, then open one for its report.</small></span><ArrowUpRight size={15} /></a>
                </div>
                <div className="help-faq">
                  <h3>Frequently asked questions</h3>
                  <details><summary>Can I explore the sample without signing in?</summary><p>Yes. The read-only sample uses fictional results and does not connect to GitHub. To use the real workflow with your own repository, sign in with your GitHub account.</p></details>
                  <details><summary>Does the live workflow require GitHub sign-in?</summary><p>Yes. Sign in with your own GitHub account, then install the DiffHarbor app on a public repository you control or are allowed to connect.</p></details>
                  <details><summary>Can I connect a non-Python project?</summary><p>You can configure shell commands for its tests, such as npm test or go test, if its runtime is available in the repository workflow. DiffHarbor currently maps Python impact only; other languages get check comparisons but no language-specific impact map.</p></details>
                  <details><summary>What does impact analysis tell me?</summary><p>It maps changed Python modules to affected files and common decorator-based API routes. It is a useful map, not a complete proof of runtime behavior.</p></details>
                  <details><summary>Does DiffHarbor merge or deploy my change?</summary><p>No. It reports check results and evidence. Your team decides whether to merge or release.</p></details>
                  <details><summary>Where can I find the setup guide?</summary><p><a href={README_JUDGE_GUIDE_URL} target="_blank" rel="noreferrer">Open the judge quick start and setup links <ArrowUpRight size={13} /></a></p></details>
                </div>
              </div>
            </section>}
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
                <div className="empty-state"><div className="empty-state-icon"><Waypoints size={19} /></div><strong>{detailError || (user ? 'No run selected yet' : 'Sign in to see impact maps')}</strong><span>{user ? 'Open a pull request in an installed repository to create the first rehearsal.' : 'DiffHarbor traces changed Python modules to affected files and API routes.'}</span></div>
              )}
            </section>
            <section className="empty-panel evidence-panel">
              <div className="panel-heading"><div><h3>Run evidence</h3><p>Baseline compared with the pull request candidate</p></div><ShieldCheck size={18} /></div>
              {loadingDetail ? (
                <div className="empty-state"><strong>Loading check results</strong></div>
              ) : runDetail ? (
                <div className="evidence-content">
                  {checkSummary ? <div className={`comparison-summary tone-${checkSummary.tone}`} role="status">
                    <span className="comparison-summary-icon" aria-hidden="true">{checkSummary.tone === 'success' ? '✓' : checkSummary.tone === 'danger' ? '!' : 'i'}</span>
                    <div><strong>{checkSummary.title}</strong><p>{checkSummary.description}</p></div>
                  </div> : null}
                  {runDetail.findings.length ? <div className="finding-list">{runDetail.findings.slice(0, 4).map((finding) => <article className="finding-row" key={finding.id}><div><span className={`severity-pill severity-${finding.severity}`}>{finding.severity}</span><strong>{finding.title}</strong></div><p>{finding.description}{finding.file_path ? ` · ${finding.file_path}${finding.line_start ? `:${finding.line_start}` : ''}` : ''}</p></article>)}</div> : checkSummary ? null : <div className="no-findings">No check findings were reported.</div>}
                  {runDetail.check_results.length ? <div className="check-list"><div className="check-head"><span>Check</span><span>Base</span><span>Candidate</span></div>{runDetail.check_results.map((check, index) => {
                    const insight = getCheckInsight(check);
                    return <details className="check-item" key={`${check.name}-${index}`}>
                      <summary>
                        <span className="check-name-cell"><span className="check-name">{check.name}</span><span className={`comparison-label label-${insight.kind}`}>{insight.label}</span></span>
                        <span className={`check-status check-${check.baseline.status}`}>{check.baseline.status.replaceAll('_', ' ')}</span>
                        <span className={`check-status check-${check.candidate.status}`}>{check.candidate.status.replaceAll('_', ' ')}</span>
                      </summary>
                      <div className="check-insight-copy">{insight.explanation}</div>
                      <div className="check-logs"><div><strong>Base output</strong><pre>{check.baseline.output_excerpt || 'No output captured.'}</pre></div><div><strong>Candidate output</strong><pre>{check.candidate.output_excerpt || 'No output captured.'}</pre></div></div>
                    </details>;
                  })}</div> : <div className="no-findings">No checks have been attached to this run yet.</div>}
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
                    <a className={`run-row ${selectedRunId === run.id ? 'run-row-selected' : ''}`} href={pageHref(demoMode, 'run-detail', run.id)} key={run.id} aria-current={selectedRunId === run.id ? 'true' : undefined}>
                      <span className={`run-status status-${run.status}`} />
                      <span className="run-copy"><strong>{run.repository_owner}/{run.repository_name} · #{run.pull_request_number}</strong><span>{run.pull_request_title}</span></span>
                      <span className="run-state">{run.status.replaceAll('_', ' ')}</span>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="empty-state"><div className="empty-state-icon"><Activity size={19} /></div><strong>{loadingRuns ? 'Loading rehearsal runs' : user ? 'No rehearsal runs yet' : 'Sign in to view activity'}</strong><span>{user ? 'Each run records the commit pair, checks, and evidence for review.' : 'Activity is limited to GitHub installations you can access.'}</span></div>
              )}
            </section>
          </div>
          <footer className="page-footer" id="github-setup"><span>DiffHarbor</span><span>Evidence before release</span><span>{demoMode ? 'Fictional sample · read only' : 'v0.1 preview'}</span></footer>
        </section>
      </main>
    </div>
  );
}

export default App;
