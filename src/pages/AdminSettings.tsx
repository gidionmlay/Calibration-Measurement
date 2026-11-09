import {
  ShieldCheckIcon,
  DatabaseIcon,
  FileCode2Icon,
  LockIcon,
  ServerIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSession } from '../contexts/SessionContext';
import { PageHeader } from '../components/shell/PageHeader';
import { Button } from '../components/ui/Button';
import { Notice } from '../components/ui/Notice';

export function AdminSettings() {
  const { user, hasRole } = useAuth();
  const { goTo } = useSession();

  const isAdmin = hasRole('admin') || hasRole('supervisor');

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="System configuration and platform infrastructure."
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
          Your current account is configured with standard measurer privileges. System settings are reserved for platform administrators.
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div>
        <PageHeader
          title="Settings"
          description="System configuration, official measurement standard specifications, and cryptographic security."
        />
        <div className="mt-1 flex items-center gap-2 text-xs font-medium text-emerald-800">
          <ShieldCheckIcon className="h-4 w-4 text-emerald-600" />
          <span>System Administrator Configuration &mdash; Read & Verify Mode</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 1. Measurement Standard & Working Specification */}
        <div className="rounded-xl border border-line bg-panel p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileCode2Icon className="h-5 w-5 text-indigo-600" />
            <span>Governing Road Measurement Standard</span>
          </div>
          <p className="text-xs text-sub leading-relaxed">
            Standard calibration parameters and calculation rulesets applied to all field ride measurements.
          </p>

          <dl className="divide-y divide-line/40 text-xs">
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Standard Version</dt>
              <dd className="font-mono font-semibold text-ink">ws-0.3-provisional</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Policy Status</dt>
              <dd className="inline-flex items-center gap-1 text-amber-700 font-medium">
                <AlertTriangleIcon className="h-3.5 w-3.5" />
                <span>Pending Ratification (MP-01..MP-09)</span>
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Short Course Safety Factor</dt>
              <dd className="font-mono text-ink">1.001 (+1 / 1000m prevention factor)</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Minimum Calibration Rides</dt>
              <dd className="font-mono text-ink">4 consecutive complete runs</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Maximum Ride Spread Tolerance</dt>
              <dd className="font-mono text-ink">&le; 4 counts (&le; 0.08% spread)</dd>
            </div>
          </dl>
        </div>

        {/* 2. Cryptographic Audit Ledger & Security */}
        <div className="rounded-xl border border-line bg-panel p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <LockIcon className="h-5 w-5 text-emerald-600" />
            <span>Cryptographic Ledger & Attestation</span>
          </div>
          <p className="text-xs text-sub leading-relaxed">
            Tamper-evident append-only ledger and SHA-256 certificate hashing mechanisms.
          </p>

          <dl className="divide-y divide-line/40 text-xs">
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Database Immutability Trigger</dt>
              <dd className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2Icon className="h-3.5 w-3.5" />
                <span>trg_protect_audit_events_mutation (Active)</span>
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Hash Chaining Algorithm</dt>
              <dd className="font-mono text-ink">SHA-256 (Canonical JSON)</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Certificate Seal Attestation</dt>
              <dd className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2Icon className="h-3.5 w-3.5" />
                <span>64-character SHA-256 Fingerprint</span>
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Password Hashing KDF</dt>
              <dd className="font-mono text-ink">scrypt (16-byte CSPRNG salt)</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Access Token Scheme</dt>
              <dd className="font-mono text-ink">HS256 JWT (Role & Permission embedded)</dd>
            </div>
          </dl>
        </div>

        {/* 3. Infrastructure & Database Engine */}
        <div className="rounded-xl border border-line bg-panel p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <DatabaseIcon className="h-5 w-5 text-blue-600" />
            <span>Database & Calculation Engine</span>
          </div>
          <p className="text-xs text-sub leading-relaxed">
            Authoritative persistence infrastructure and pure Decimal mathematical engines.
          </p>

          <dl className="divide-y divide-line/40 text-xs">
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Database Management System</dt>
              <dd className="font-mono text-ink">PostgreSQL 16</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Alembic Migration Head</dt>
              <dd className="font-mono text-ink">0005_local_auth_credentials</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Calculation Accuracy Engine</dt>
              <dd className="font-mono text-ink">Python 3.13 pure Decimal (Exact)</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Database Binding</dt>
              <dd className="font-mono text-ink">127.0.0.1:5433 (Loopback restricted)</dd>
            </div>
          </dl>
        </div>

        {/* 4. Active Administrator Profile */}
        <div className="rounded-xl border border-line bg-panel p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ServerIcon className="h-5 w-5 text-purple-600" />
            <span>Active Administrator Session</span>
          </div>
          <p className="text-xs text-sub leading-relaxed">
            Identity and security credentials for the currently authenticated operator.
          </p>

          <dl className="divide-y divide-line/40 text-xs">
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Administrator Name</dt>
              <dd className="font-medium text-ink">{user?.display_name || 'System Admin'}</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Account Email</dt>
              <dd className="font-mono text-ink">{user?.email || 'admin@calibration.local'}</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Governing Organization</dt>
              <dd className="font-medium text-ink">{user?.organization || 'World Athletics / AIMS'}</dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Active System Roles</dt>
              <dd className="flex gap-1">
                {user?.roles?.map((r) => (
                  <span
                    key={r}
                    className="inline-flex rounded bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 border border-purple-200"
                  >
                    {r}
                  </span>
                )) || <span className="font-mono text-ink">admin</span>}
              </dd>
            </div>
            <div className="py-2.5 flex justify-between">
              <dt className="text-sub font-medium">Session Permissions</dt>
              <dd className="text-right text-[11px] font-mono text-sub max-w-[200px] truncate" title={user?.permissions?.join(', ')}>
                {user?.permissions?.length ? `${user.permissions.length} capabilities active` : 'All Administrative'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
