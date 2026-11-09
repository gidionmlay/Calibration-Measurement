import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  UsersIcon,
  FileCheckIcon,
  FolderIcon,
  ClockIcon,
  SearchIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
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
  const [searchTerm, setSearchTerm] = useState('');

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

  const filteredRecent = useMemo(() => {
    if (!metrics) return [];
    if (!searchTerm.trim()) return metrics.recent_activity;
    const lower = searchTerm.toLowerCase();
    return metrics.recent_activity.filter(
      (s) =>
        s.reference.toLowerCase().includes(lower) ||
        s.measurer_name.toLowerCase().includes(lower) ||
        (s.course_name && s.course_name.toLowerCase().includes(lower)),
    );
  }, [metrics, searchTerm]);

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Operational Overview"
          description="System-wide metrics across active field measurers, sessions, and finalized measurement reports."
        />
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

      {/* 1. KPI Metric Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Field Measurers */}
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
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
            <p className="mt-1 text-xs text-sub">Registered active operators</p>
          </div>
        </div>

        {/* Total Sessions */}
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
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
            <p className="mt-1 text-xs text-sub">All logged measurements</p>
          </div>
        </div>

        {/* Finalized Reports */}
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
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
            <p className="mt-1 text-xs text-sub">Completed & locked reports</p>
          </div>
        </div>

        {/* In-Progress Drafts */}
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
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
            <p className="mt-1 text-xs text-sub">Open in-field measurements</p>
          </div>
        </div>
      </div>

      {/* 2. Monthly Activity Trends */}
      {metrics && metrics.monthly_activity.length > 0 && (
        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-sub">
            Monthly Report Activity (Past 6 Months)
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {metrics.monthly_activity.map((m) => (
              <div
                key={m.month}
                className="flex flex-col items-center rounded border border-line/60 bg-surface p-3 text-center"
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

      {/* 3. Recent Sessions Overview Table */}
      <div className="rounded-lg border border-line bg-panel p-5 shadow-sm space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Recent Measurement Activity</h2>
            <p className="text-xs text-sub">Latest sessions submitted by field measurers across the system.</p>
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-sub" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search reference or measurer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded border border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-ink"
            />
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
              {filteredRecent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sub">
                    {loading ? 'Loading measurement activity...' : 'No sessions match your search criteria.'}
                  </td>
                </tr>
              ) : (
                filteredRecent.map((s) => (
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
                            ? 'bg-emerald-50 text-emerald-700'
                            : s.status === 'needs_review'
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-amber-50 text-amber-700'
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
                        className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink hover:bg-fill focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink"
                        title="Open session record"
                      >
                        <span>Open</span>
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
    </div>
  );
}
