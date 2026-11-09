import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Notice } from '../ui/Notice';
import { LockIcon, MailIcon, UserIcon, Building2Icon } from 'lucide-react';
import { toast } from 'sonner';

export function AuthModal() {
  const {
    isAuthModalOpen,
    authModalTab,
    closeAuthModal,
    loginWithCredentials,
    registerWithCredentials,
  } = useAuth();

  const [tab, setTab] = useState<'signin' | 'register'>('signin');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Sign In form fields
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form fields
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regOrg, setRegOrg] = useState('');

  useEffect(() => {
    if (isAuthModalOpen) {
      setTab(authModalTab);
      setFormError(null);
    } else {
      setLoginEmail('');
      setLoginPassword('');
      setRegName('');
      setRegEmail('');
      setRegPassword('');
      setRegOrg('');
      setFormError(null);
      setSubmitting(false);
    }
  }, [isAuthModalOpen, authModalTab]);

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
      toast.success('Account created! Welcome to Bicycle Calibration.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={isAuthModalOpen}
      onClose={closeAuthModal}
      title={tab === 'signin' ? 'Sign In' : 'Create Measurer Account'}
      description={
        tab === 'signin'
          ? 'Sign in to access your calibration sessions and generate reports.'
          : 'Register as an autonomous Field Measurer with immediate measurement privileges.'
      }
      size="md"
    >
      <div className="space-y-4">
        {/* Tab switch header */}
        <div className="flex border-b border-line">
          <button
            type="button"
            onClick={() => {
              setTab('signin');
              setFormError(null);
            }}
            className={`flex-1 border-b-2 py-2 text-center text-sm font-medium transition-colors ${
              tab === 'signin'
                ? 'border-ink text-ink'
                : 'border-transparent text-sub hover:text-ink'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('register');
              setFormError(null);
            }}
            className={`flex-1 border-b-2 py-2 text-center text-sm font-medium transition-colors ${
              tab === 'register'
                ? 'border-ink text-ink'
                : 'border-transparent text-sub hover:text-ink'
            }`}
          >
            Create Account
          </button>
        </div>

        {formError && (
          <Notice tone="error" title="Authentication Error">
            {formError}
          </Notice>
        )}

        {tab === 'signin' ? (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Email Address
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <MailIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="measurer@athletics.org"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="login-password" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Password
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <LockIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !loginEmail.trim() || !loginPassword}
                className="w-full justify-center"
              >
                {submitting ? 'Signing in...' : 'Sign In'}
              </Button>
            </div>

            <div className="text-center text-xs text-sub">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setFormError(null);
                }}
                className="font-medium text-ink underline hover:text-black"
              >
                Create one now
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="space-y-4">
            <div>
              <label htmlFor="reg-name" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Full Name
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <UserIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="reg-name"
                  type="text"
                  required
                  autoFocus
                  autoComplete="name"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  placeholder="Jane Measurer"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-email" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Email Address
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <MailIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="reg-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="measurer@athletics.org"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-password" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Password (min. 8 characters)
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <LockIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="reg-password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div>
              <label htmlFor="reg-org" className="block text-xs font-semibold uppercase tracking-wider text-sub">
                Affiliation / Organization <span className="font-normal text-faint">(Optional)</span>
              </label>
              <div className="relative mt-1">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sub">
                  <Building2Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <input
                  id="reg-org"
                  type="text"
                  value={regOrg}
                  onChange={(e) => setRegOrg(e.target.value)}
                  placeholder="e.g. World Athletics / AIMS / Federation"
                  className="w-full rounded border border-line bg-panel pl-9 pr-3 py-2 text-sm text-ink placeholder-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
                />
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !regName.trim() || !regEmail.trim() || regPassword.length < 8}
                className="w-full justify-center"
              >
                {submitting ? 'Creating account...' : 'Create Measurer Account'}
              </Button>
            </div>

            <div className="text-center text-xs text-sub">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setTab('signin');
                  setFormError(null);
                }}
                className="font-medium text-ink underline hover:text-black"
              >
                Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
