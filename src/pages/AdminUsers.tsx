import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  UsersIcon,
  ShieldCheckIcon,
  Building2Icon,
  MailIcon,
  SearchIcon,
  RefreshCwIcon,
  CheckCircle2Icon,
  UserCheckIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { api } from '../services/api';
import { FieldMeasurerItem } from '../services/api/types';
import { PageHeader } from '../components/shell/PageHeader';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';
import { formatDateTime } from '../utils/format';

const DEFAULT_MOCK_MEASURERS: FieldMeasurerItem[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    display_name: 'Alex Rivera',
    email: 'alex.measurer@calibration.local',
    organization: 'World Athletics Grade A',
    roles: ['measurer'],
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    session_count: 8,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    display_name: 'Jordan Hayes',
    email: 'jordan.supervisor@calibration.local',
    organization: 'AIMS Senior Measurer',
    roles: ['supervisor', 'measurer'],
    status: 'active',
    created_at: '2026-01-10T00:00:00Z',
    session_count: 14,
  },
  {
    id: '55555555-5555-4555-8555-555555555555',
    display_name: 'Pat Chen',
    email: 'pat.admin@calibration.local',
    organization: 'Global Athletics Federation',
    roles: ['admin', 'supervisor'],
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    session_count: 0,
  },
];

export function AdminUsers() {
  const { user, hasRole, isMockAuth } = useAuth();
  const { goTo } = useSession();

  const [measurers, setMeasurers] = useState<FieldMeasurerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'measurer' | 'admin'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const isAdmin = hasRole('admin') || hasRole('supervisor');

  const fetchUsers = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await api.admin.getOverview();
      setMeasurers(data.measurers || []);
    } catch (err) {
      if (isMockAuth) {
        setMeasurers(DEFAULT_MOCK_MEASURERS);
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to fetch registered users.');
      }
    } finally {
      setLoading(false);
    }
  }, [isAdmin, isMockAuth]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // Aggregate counts
  const stats = useMemo(() => {
    const total = measurers.length;
    const active = measurers.filter((m) => m.status === 'active').length;
    const measurerCount = measurers.filter((m) => m.roles.includes('measurer')).length;
    const adminCount = measurers.filter((m) => m.roles.some((r) => r === 'admin' || r === 'supervisor')).length;
    return { total, active, measurerCount, adminCount };
  }, [measurers]);

  // Filtered users
  const filteredUsers = useMemo(() => {
    let list = measurers;
    if (statusFilter === 'active') {
      list = list.filter((m) => m.status === 'active');
    } else if (statusFilter === 'measurer') {
      list = list.filter((m) => m.roles.includes('measurer'));
    } else if (statusFilter === 'admin') {
      list = list.filter((m) => m.roles.some((r) => r === 'admin' || r === 'supervisor'));
    }

    if (!searchTerm.trim()) return list;
    const lower = searchTerm.toLowerCase();
    return list.filter(
      (m) =>
        m.display_name.toLowerCase().includes(lower) ||
        (m.email && m.email.toLowerCase().includes(lower)) ||
        (m.organization && m.organization.toLowerCase().includes(lower)),
    );
  }, [measurers, statusFilter, searchTerm]);

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Users"
          description="View active and registered users across the platform."
        />
        <Notice
          tone="warning"
          title="Administrative Access Required"
          actions={
            <Button size="sm" onClick={() => goTo('list')}>
              Return to Workspace
            </Button>
          }
        >
          Your current account ({user?.display_name || user?.email || 'Field Measurer'}) is configured with standard measurer privileges. This directory is reserved for system administrators.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <PageHeader
            title="Users"
            description="Manage active users and view all registered field measurers across the organization."
          />
          <div className="mt-1 flex items-center gap-2 text-xs font-medium text-emerald-800">
            <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
            <span>Administrator Directory &mdash; RBAC User Identity & Account Observability</span>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCwIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />}
          onClick={fetchUsers}
          disabled={loading}
        >
          Refresh Users
        </Button>
      </div>

      {error && (
        <Notice
          tone="error"
          title="Unable to load users"
          actions={
            <Button size="sm" onClick={fetchUsers}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      )}

      {/* 1. User Summary Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Total Registered */}
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          className={`rounded-xl border p-4 text-left transition-all shadow-xs hover:border-blue-400 ${
            statusFilter === 'all'
              ? 'border-blue-500 bg-blue-50/40 ring-2 ring-blue-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="stat-total-users"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              All Registered
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-blue-50 text-blue-600">
              <UsersIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight text-ink">
              {loading ? '—' : stats.total}
            </span>
            <p className="mt-0.5 text-xs text-sub">All platform accounts</p>
          </div>
        </button>

        {/* Active Accounts */}
        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          className={`rounded-xl border p-4 text-left transition-all shadow-xs hover:border-emerald-400 ${
            statusFilter === 'active'
              ? 'border-emerald-500 bg-emerald-50/40 ring-2 ring-emerald-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="stat-active-users"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Active Users
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2Icon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight text-emerald-600">
              {loading ? '—' : stats.active}
            </span>
            <p className="mt-0.5 text-xs text-sub">Status: active</p>
          </div>
        </button>

        {/* Field Measurers */}
        <button
          type="button"
          onClick={() => setStatusFilter('measurer')}
          className={`rounded-xl border p-4 text-left transition-all shadow-xs hover:border-amber-400 ${
            statusFilter === 'measurer'
              ? 'border-amber-500 bg-amber-50/40 ring-2 ring-amber-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="stat-measurer-users"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Field Measurers
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-amber-50 text-amber-600">
              <UserCheckIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight text-amber-600">
              {loading ? '—' : stats.measurerCount}
            </span>
            <p className="mt-0.5 text-xs text-sub">With measurer role</p>
          </div>
        </button>

        {/* Administrators */}
        <button
          type="button"
          onClick={() => setStatusFilter('admin')}
          className={`rounded-xl border p-4 text-left transition-all shadow-xs hover:border-purple-400 ${
            statusFilter === 'admin'
              ? 'border-purple-500 bg-purple-50/40 ring-2 ring-purple-500/20'
              : 'border-line bg-panel'
          }`}
          data-testid="stat-admin-users"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sub">
              Administrators
            </span>
            <div className="grid h-8 w-8 place-items-center rounded-full bg-purple-50 text-purple-600">
              <ShieldCheckIcon className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-bold tracking-tight text-purple-600">
              {loading ? '—' : stats.adminCount}
            </span>
            <p className="mt-0.5 text-xs text-sub">Admin & Supervisor roles</p>
          </div>
        </button>
      </div>

      {/* 2. Directory Table Section */}
      <div className="rounded-xl border border-line bg-panel p-5 shadow-xs space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Quick Filter Buttons */}
          <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface text-xs font-medium">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-3 py-1 transition-all ${
                statusFilter === 'all'
                  ? 'bg-panel text-ink shadow-xs font-semibold'
                  : 'text-sub hover:text-ink'
              }`}
            >
              All Users ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`rounded-md px-3 py-1 transition-all ${
                statusFilter === 'active'
                  ? 'bg-panel text-emerald-700 shadow-xs font-semibold'
                  : 'text-sub hover:text-ink'
              }`}
            >
              Active ({stats.active})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('measurer')}
              className={`rounded-md px-3 py-1 transition-all ${
                statusFilter === 'measurer'
                  ? 'bg-panel text-amber-700 shadow-xs font-semibold'
                  : 'text-sub hover:text-ink'
              }`}
            >
              Measurers ({stats.measurerCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('admin')}
              className={`rounded-md px-3 py-1 transition-all ${
                statusFilter === 'admin'
                  ? 'bg-panel text-purple-700 shadow-xs font-semibold'
                  : 'text-sub hover:text-ink'
              }`}
            >
              Admins ({stats.adminCount})
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-72">
            <SearchIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-sub" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search by name, email, or org..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-md border border-line bg-surface py-1.5 pl-8 pr-3 text-sm text-ink outline-none transition focus:border-ink"
              data-testid="search-users-input"
            />
          </div>
        </div>

        {/* Users Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm" data-testid="users-table">
            <thead className="border-b border-line bg-surface/50 text-xs font-semibold uppercase text-sub">
              <tr>
                <th scope="col" className="px-3 py-2.5">User</th>
                <th scope="col" className="px-3 py-2.5">Organization / Affiliation</th>
                <th scope="col" className="px-3 py-2.5">System Roles</th>
                <th scope="col" className="px-3 py-2.5 text-center">Sessions Logged</th>
                <th scope="col" className="px-3 py-2.5">Status</th>
                <th scope="col" className="px-3 py-2.5">Registered Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/40 font-normal">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sub">
                    {loading
                      ? 'Loading registered users...'
                      : 'No users match your criteria.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => (
                  <tr key={u.id} className="hover:bg-fill/40 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-ink">{u.display_name}</div>
                      {u.email && (
                        <div className="flex items-center gap-1 text-xs text-sub">
                          <MailIcon className="h-3 w-3 text-faint" />
                          <span>{u.email}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-sub">
                      <div className="flex items-center gap-1.5">
                        <Building2Icon className="h-3.5 w-3.5 text-faint shrink-0" />
                        <span>{u.organization || 'Independent Operator'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
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
                        {u.session_count}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium ${
                          u.status === 'active'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            u.status === 'active' ? 'bg-emerald-600' : 'bg-amber-600'
                          }`}
                        />
                        <span className="capitalize">{u.status}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-sub">
                      {formatDateTime(u.created_at)}
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
