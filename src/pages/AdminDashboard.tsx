import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  UsersIcon,
  FileCheckIcon,
  FolderIcon,
  ClockIcon,
  SearchIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
  ShieldCheckIcon,
  Building2Icon,
  MailIcon,
  LayersIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { api } from '../services/api';
import { AdminOverviewMetrics } from '../services/api/types';
import { PageHeader } from '../components/shell/PageHeader';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { formatDateTime } from '../utils/format';

export function AdminDashboard() {
  const { user, hasRole } = useAuth();
  const { openSession, goTo } = useSession();

  const [metrics, setMetrics] = useState<AdminOverviewMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View & Filter States
  const [activeTab, setActiveTab] = useState<'sessions' | 'measurers'>('sessions');
  const [sessionFilter, setSessionFilter] = useState<'all' | 'finalized' | 'draft'>('all');
  const [sessionSearch, setSessionSearch] = useState('');
  const [measurerSearch, setMeasurerSearch] = useState('');

  const isAdmin = hasRole('admin') || hasRole('supervisor');

  const fetchMetrics = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.admin.getOverview();
      setMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch admin overview metrics.');
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // Filtered Sessions
  const filteredSessions = useMemo(() => {
    if (!metrics) return [];
    let list = metrics.recent_activity;
    if (sessionFilter === 'finalized') {
      list = list.filter((s) => s.status === 'finalized');
    } else if (sessionFilter === 'draft') {
      list = list.filter((s) => s.status !== 'finalized');
    }
    if (!sessionSearch.trim()) return list;
    const lower = sessionSearch.toLowerCase();
    return list.filter(
      (s) =>
        s.reference.toLowerCase().includes(lower) ||
        s.measurer_name.toLowerCase().includes(lower) ||
        (s.course_name && s.course_name.toLowerCase().includes(lower)),
    );
  }, [metrics, sessionFilter, sessionSearch]);

  // Filtered Measurers
  const filteredMeasurers = useMemo(() => {
    if (!metrics) return [];
    const list = metrics.measurers || [];
    if (!measurerSearch.trim()) return list;
    const lower = measurerSearch.toLowerCase();
    return list.filter(
      (m) =>
        m.display_name.toLowerCase().includes(lower) ||
        (m.email && m.email.toLowerCase().includes(lower)) ||
        (m.organization && m.organization.toLowerCase().includes(lower)),
    );
  }, [metrics, measurerSearch]);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Admin Overview"
          description="Operational dashboard for program supervisors and administrators."
        />
        <Notice
          tone="warning"
          title="Administrative Access Required"
          actions={
            <Button size="sm" onClick={() => goTo('list')}>
              Return to Sessions
            </Button>
          }
        >
          Your current account ({user?.display_name || user?.email || 'Field Measurer'}) is configured with standard measurer privileges. This dashboard provides aggregate overview metrics for system administrators and supervisors.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header & Refresh */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
            title="Operational Overview"
            description="System-wide metrics across active field measurers, sessions, and finalized measurement reports."
          />
          <div className="mt-1 flex items-center gap-2 text-xs font-medium text-emerald-800">
            <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
            <span>Administrator View &mdash; Observability & Verification Mode (Read-Only)</span>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
          onClick={fetchMetrics}
          disabled={loading}
        >
          Refresh Data
        </Button>
      </div>

      {error && (
        <Notice
          tone="error"
          title="Unable to load overview metrics"
          actions={
            <Button size="sm" onClick={fetchMetrics}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      )}

      {/* 1. Interactive KPI Metric Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Field Measurers Card */}
        <button
          type="button"
          onClick={() => setActiveTab('measurers')}
          className={`relative rounded-xl border p-5 text-left transition-all shadow-xs hover:border-blue-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${
            activeTab === 'measurers'
              ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="kpi-card-measurers"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Field Measurers
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-blue-600">
              <UsersIcon className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold tracking-tight text-ink">
              {loading ? '—' : metrics?.total_users ?? 0}
            </span>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-sub">Registered active operators</p>
              <span className="text-[11px] font-medium text-blue-600 underline">View all &rarr;</span>
            </div>
          </div>
        </button>

        {/* Total Sessions Card */}
        <button
          type="button"
          onClick={() => {
            setActiveTab('sessions');
            setSessionFilter('all');
          }}
          className={`relative rounded-xl border p-5 text-left transition-all shadow-xs hover:border-purple-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-600 ${
            activeTab === 'sessions' && sessionFilter === 'all'
              ? 'border-purple-500 bg-purple-50/40 ring-2 ring-purple-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="kpi-card-total-sessions"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Total Sessions
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-purple-50 text-purple-600">
              <FolderIcon className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold tracking-tight text-ink">
              {loading ? '—' : metrics?.total_sessions ?? 0}
            </span>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-sub">All logged measurements</p>
              <span className="text-[11px] font-medium text-purple-600 underline">View all &rarr;</span>
            </div>
          </div>
        </button>

        {/* Finalized Reports Card */}
        <button
          type="button"
          onClick={() => {
            setActiveTab('sessions');
            setSessionFilter('finalized');
          }}
          className={`relative rounded-xl border p-5 text-left transition-all shadow-xs hover:border-emerald-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 ${
            activeTab === 'sessions' && sessionFilter === 'finalized'
              ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="kpi-card-finalized-reports"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Finalized Reports
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <FileCheckIcon className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold tracking-tight text-emerald-600">
              {loading ? '—' : metrics?.total_finalized_reports ?? 0}
            </span>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-sub">Completed & certified reports</p>
              <span className="text-[11px] font-medium text-emerald-600 underline">View &rarr;</span>
            </div>
          </div>
        </button>

        {/* In-Progress Drafts Card */}
        <button
          type="button"
          onClick={() => {
            setActiveTab('sessions');
            setSessionFilter('draft');
          }}
          className={`relative rounded-xl border p-5 text-left transition-all shadow-xs hover:border-amber-400 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-600 ${
            activeTab === 'sessions' && sessionFilter === 'draft'
              ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="kpi-card-active-drafts"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Active Drafts
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-amber-50 text-amber-600">
              <ClockIcon className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
          <div className="mt-3">
            <span className="text-3xl font-bold tracking-tight text-amber-600">
              {loading ? '—' : metrics?.total_draft_sessions ?? 0}
            </span>
            <div className="mt-1 flex items-center justify-between">
              <p className="text-xs text-sub">Open in-field measurements</p>
              <span className="text-[11px] font-medium text-amber-600 underline">View &rarr;</span>
            </div>
          </div>
        </button>
      </div>

      {/* 2. Monthly Activity Trends */}
      {metrics && metrics.monthly_activity.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-5 shadow-xs">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-sub">
            Monthly Report Activity (Past 6 Months)
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {metrics.monthly_activity.map((m) => (
              <div
                key={m.month}
                className="flex flex-col items-center rounded-lg border border-line/60 bg-surface p-3 text-center"
              >
                <span className="text-xs font-medium text-sub">{m.month}</span>
                <span className="mt-1 text-xl font-bold text-ink">{m.report_count}</span>
                <span className="text-[11px] text-emerald-600 font-medium">reports finalized</span>
                <span className="mt-1 text-[10px] text-faint">({m.session_count} total sessions)</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Section Navigation Tabs */}
      <div className="flex border-b border-line">
        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'sessions'
              ? 'border-ink text-ink'
              : 'border-transparent text-sub hover:text-ink'
          }`}
          data-testid="admin-tab-sessions"
        >
          <LayersIcon className="h-4 w-4" />
          <span>Measurement Sessions & Reports</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-sub">
            {metrics?.total_sessions ?? 0}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('measurers')}
          className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
            activeTab === 'measurers'
              ? 'border-ink text-ink'
              : 'border-transparent text-sub hover:text-ink'
          }`}
          data-testid="admin-tab-measurers"
        >
          <UsersIcon className="h-4 w-4" />
          <span>Field Measurers Directory</span>
          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-sub">
            {metrics?.total_users ?? 0}
          </span>
        </button>
      </div>

      {/* TAB 1: Measurement Sessions & Reports */}
      {activeTab === 'sessions' && (
        <div className="rounded-xl border border-line bg-panel p-5 shadow-xs space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Recent Measurement Activity</h2>
              <p className="text-xs text-sub">Latest sessions recorded by field measurers across all courses.</p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {/* Quick Status Filters */}
              <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setSessionFilter('all')}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    sessionFilter === 'all'
                      ? 'bg-panel text-ink shadow-xs font-semibold'
                      : 'text-sub hover:text-ink'
                  }`}
                >
                  All ({metrics?.total_sessions ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setSessionFilter('finalized')}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    sessionFilter === 'finalized'
                      ? 'bg-panel text-emerald-700 shadow-xs font-semibold'
                      : 'text-sub hover:text-ink'
                  }`}
                >
                  Finalized ({metrics?.total_finalized_reports ?? 0})
                </button>
                <button
                  type="button"
                  onClick={() => setSessionFilter('draft')}
                  className={`rounded-md px-2.5 py-1 transition-all ${
                    sessionFilter === 'draft'
                      ? 'bg-panel text-amber-700 shadow-xs font-semibold'
                      : 'text-sub hover:text-ink'
                  }`}
                >
                  Drafts ({metrics?.total_draft_sessions ?? 0})
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-sub" aria-hidden="true" />
                <input
                  type="text"
                  placeholder="Search reference or measurer..."
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-ink"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-surface/50 text-xs font-semibold uppercase text-sub">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Reference</th>
                  <th scope="col" className="px-3 py-2.5">Field Measurer</th>
                  <th scope="col" className="px-3 py-2.5">Course Name & Length</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5">Date</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40 font-normal">
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sub">
                      {loading
                        ? 'Loading measurement activity...'
                        : sessionFilter !== 'all'
                        ? `No ${sessionFilter} sessions match your criteria.`
                        : 'No sessions match your search criteria.'}
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => (
                    <tr key={s.id} className="hover:bg-fill/40 transition-colors">
                      <td className="px-3 py-2.5 font-mono font-medium text-ink">
                        {s.reference}
                      </td>
                      <td className="px-3 py-2.5 text-ink">{s.measurer_name}</td>
                      <td className="px-3 py-2.5 text-sub">
                        {s.course_name ? `${s.course_name} (${s.course_length_m}m)` : `${s.course_length_m}m`}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                            s.status === 'finalized'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : s.status === 'needs_review'
                              ? 'bg-blue-50 text-blue-700 border border-blue-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-sub">
                        {formatDateTime(s.created_at)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => openSession(s.reference)}
                          className="inline-flex items-center gap-1 rounded border border-line bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink transition-colors"
                          title="Open session record for review"
                        >
                          <span>Review</span>
                          <ExternalLinkIcon className="h-3 w-3 text-sub" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Field Measurers Directory */}
      {activeTab === 'measurers' && (
        <div className="rounded-xl border border-line bg-panel p-5 shadow-xs space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Field Measurers Directory</h2>
              <p className="text-xs text-sub">All registered measurers and authorized calibration operators.</p>
            </div>

            <div className="relative w-full sm:w-64">
              <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-sub" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search measurer, org, or email..."
                value={measurerSearch}
                onChange={(e) => setMeasurerSearch(e.target.value)}
                className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-ink"
                data-testid="search-measurers-input"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="measurers-table">
              <thead className="border-b border-line bg-surface/50 text-xs font-semibold uppercase text-sub">
                <tr>
                  <th scope="col" className="px-3 py-2.5">Measurer</th>
                  <th scope="col" className="px-3 py-2.5">Organization / Affiliation</th>
                  <th scope="col" className="px-3 py-2.5">System Roles</th>
                  <th scope="col" className="px-3 py-2.5 text-center">Sessions Logged</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5">Registered</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/40 font-normal">
                {filteredMeasurers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-sub">
                      {loading
                        ? 'Loading field measurers...'
                        : 'No measurers match your search criteria.'}
                    </td>
                  </tr>
                ) : (
                  filteredMeasurers.map((m) => (
                    <tr key={m.id} className="hover:bg-fill/40 transition-colors">
                      <td className="px-3 py-2.5">
                        <div className="font-medium text-ink">{m.display_name}</div>
                        {m.email && (
                          <div className="flex items-center gap-1 text-xs text-sub">
                            <MailIcon className="h-3 w-3 text-faint" />
                            <span>{m.email}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-sub">
                        <div className="flex items-center gap-1.5">
                          <Building2Icon className="h-3.5 w-3.5 text-faint shrink-0" />
                          <span>{m.organization || 'Independent Operator'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {m.roles.map((r) => (
                            <span
                              key={r}
                              className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                                r === 'admin'
                                  ? 'bg-purple-50 text-purple-700 border border-purple-200'
                                  : r === 'supervisor'
                                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              }`}
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className="inline-flex items-center justify-center rounded-full bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink">
                          {m.session_count}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ${
                            m.status === 'active'
                              ? 'text-emerald-700'
                              : 'text-amber-700'
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                          <span>{m.status}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-sub">
                        {formatDateTime(m.created_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
