import React from 'react';
import { Navigate } from 'react-router-dom';
import { useRoles } from '../lib/useRoles';
import { AppSkeleton } from './AppSkeleton';

/** Shows children only when the signed-in person holds the role. Real enforcement is on the server and in the database. */
export function RoleRoute({ role, children }: { role: 'coach' | 'admin'; children: React.ReactNode }) {
  const { loading, roles } = useRoles();
  if (loading) return <AppSkeleton />;
  if (!roles[role]) return <Navigate to="/app/today" replace />;
  return <>{children}</>;
}
