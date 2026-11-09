import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { SystemPermissionCode } from '../../services/auth/types';

interface RequirePermissionProps {
  permission: SystemPermissionCode | SystemPermissionCode[] | string | string[];
  all?: boolean;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export function RequirePermission({
  permission,
  all = false,
  fallback = null,
  children,
}: RequirePermissionProps) {
  const { hasPermission, hasAllPermissions, isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  const permissions = Array.isArray(permission) ? permission : [permission];

  const allowed = all
    ? hasAllPermissions(permissions)
    : permissions.some((p) => hasPermission(p));

  if (!allowed) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

