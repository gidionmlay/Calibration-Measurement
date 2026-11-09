import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SystemRoleName } from '../../services/auth/types';

interface RequireRoleProps {
  role: SystemRoleName | SystemRoleName[] | string | string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function RequireRole({ role, fallback = null, children }: RequireRoleProps) {
  const { hasRole, hasAnyRole, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  const roles = Array.isArray(role) ? role : [role];
  const allowed = roles.length === 1 ? hasRole(roles[0]) : hasAnyRole(roles);

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

