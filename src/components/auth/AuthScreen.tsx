import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import {
  CompassIcon,
  LockIcon,
  MailIcon,
  UserIcon,
  Building2Icon,
  CheckCircle2Icon,
  EyeIcon,
  EyeOffIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { toast } from 'sonner';

interface AuthScreenProps {
  initialTab?: 'signin' | 'register';
}

export function AuthScreen({ initialTab = 'register' }: AuthScreenProps) {
  const { loginWithCredentials, registerWithCredentials } = useAuth();
  const [tab, setTab] = useState<'signin' | 'register'>(initialTab);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Sign In fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regOrg, setRegOrg] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setFormError('Please enter both your email address and password.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await loginWithCredentials({
        email: loginEmail.trim(),
        password: loginPassword,
      });
      toast.success('Signed in successfully.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Invalid email or password.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = regName.trim();
    const cleanEmail = regEmail.trim();

    if (!cleanName || cleanName.length < 2) {
      setFormError('Full name must be at least 2 characters long.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setFormError('Please enter a valid email address.');
      return;
    }
    if (regPassword.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await registerWithCredentials({
        display_name: cleanName,
        email: cleanEmail,
        password: regPassword,
        organization: regOrg.trim() || undefined,
      });
      toast.success('Account created! Welcome to the Bicycle Calibration platform.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-lg">
        {/* Branding Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-ink text-white shadow-md">
            <CompassIcon className="h-7 w-7 text-emerald-400" />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            Bicycle Calibration
          </h1>
          <p className="mt-1 text-sm text-sub">
            Authoritative Jones Counter calibration and road course measurement.
          </p>
        </div>

        {/* Main Card */}
        <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
          {/* Segmented Tab Navigation */}
          <div className="flex border-b border-line bg-canvas/50 p-1.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'register'}
              onClick={() => {
                setTab('register');
                setFormError(null);
              }}
              className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition-all ${
                tab === 'register'
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-sub hover:text-ink'
              }`}
              data-testid="auth-tab-register"
            >
              Create Measurer Account
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              onClick={() => {
                setTab('signin');
                setFormError(null);
              }}
              className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition-all ${
                tab === 'signin'
                  ? 'bg-panel text-ink shadow-sm'
                  : 'text-sub hover:text-ink'
              }`}
              data-testid="auth-tab-signin"
            >
              Sign In
            </button>
          </div>

          <div className="p-6 sm:p-8">
            {formError && (
              <div className="mb-5">
                <Notice tone="error" title="Authentication Notice" live>
                  {formError}
                </Notice>
              </div>
            )}

            {tab === 'register' ? (
              <form onSubmit={handleRegisterSubmit} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Create Measurer Account
                  </h2>
                  <p className="mt-0.5 text-xs text-sub">
                    Fill in your credentials to operate autonomously in the field.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="reg-name"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <UserIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="reg-name"
                      type="text"
                      required
                      placeholder="e.g. Maria Lindqvist"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="reg-name-input"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-email"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <MailIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="reg-email"
                      type="email"
                      required
                      placeholder="measurer@athletics.org"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="reg-email-input"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="reg-org"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Affiliation / Organization
                  </label>
                  <div className="relative">
                    <Building2Icon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="reg-org"
                      type="text"
                      placeholder="e.g. World Athletics / AIMS / National Athletics Federation"
                      value={regOrg}
                      onChange={(e) => setRegOrg(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="reg-org-input"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-sub">
                    Included on your official calibration certificates and reports.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Password <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <LockIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="reg-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={8}
                      placeholder="At least 8 characters"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-10 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="reg-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-sub hover:text-ink focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Autonomous Activation Assurance Badge */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-950">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <CheckCircle2Icon className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Immediate Autonomous Activation</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-900">
                    No waiting for administrative approvals. Your account is
                    granted full Measurer capabilities immediately so you can
                    start operating in the field right away.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    className="w-full justify-center py-2.5 text-sm font-semibold"
                    data-testid="register-submit-btn"
                  >
                    {submitting ? 'Creating account...' : 'Create Account & Start Measuring'}
                  </Button>
                </div>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('signin');
                      setFormError(null);
                    }}
                    className="text-xs text-sub hover:text-ink font-medium underline underline-offset-4"
                  >
                    Already have an account? Sign in
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Sign In to Field Workspace
                  </h2>
                  <p className="mt-0.5 text-xs text-sub">
                    Enter your email and password to access your calibration sessions.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="login-email"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Email Address
                  </label>
                  <div className="relative">
                    <MailIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="login-email"
                      type="email"
                      required
                      placeholder="measurer@athletics.org"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="login-email-input"
                    />
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-semibold uppercase tracking-wider text-sub mb-1"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <LockIcon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-sub" />
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="Your password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-10 text-sm text-ink placeholder:text-sub/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                      data-testid="login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-sub hover:text-ink focus:outline-none"
                    >
                      {showPassword ? (
                        <EyeOffIcon className="h-4 w-4" />
                      ) : (
                        <EyeIcon className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    className="w-full justify-center py-2.5 text-sm font-semibold"
                    data-testid="login-submit-btn"
                  >
                    {submitting ? 'Signing in...' : 'Sign In'}
                  </Button>
                </div>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTab('register');
                      setFormError(null);
                    }}
                    className="text-xs text-sub hover:text-ink font-medium underline underline-offset-4"
                  >
                    New measurer? Create an account
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        {/* Security & Offline Notice Footer */}
        <div className="mt-6 text-center text-xs text-sub">
          <p className="flex items-center justify-center gap-1.5">
            <ShieldCheckIcon className="h-3.5 w-3.5 text-emerald-600" />
            <span>Local-first architecture with cryptographic SHA-256 integrity</span>
          </p>
        </div>
      </div>
    </div>
  );
}
