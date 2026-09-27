import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../api';
import type { Me, Role } from '../types';
import { RequestDetail } from './RequestDetail';
import { RequestList } from './RequestList';

export interface DashboardProps {
  api: Api;
  me: Me;
}

/**
 * Tab rule: both tabs when both have requests; only the non-empty one (no tab bar)
 * when one is empty; a single message when none concerns the user.
 */
export function visibleRoles(me: Me): Role[] {
  const roles: Role[] = [];
  if (me.hasRequested) roles.push('requester');
  if (me.hasToApprove) roles.push('approver');
  return roles;
}

export function Dashboard({ api, me }: DashboardProps) {
  const { t } = useTranslation();
  const roles = visibleRoles(me);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [first] = roles;
  if (first === undefined) {
    return <p className="empty">{t('empty.none')}</p>;
  }
  const role = selectedRole ?? first;
  const panel =
    openId === null ? (
      <RequestList key={role} api={api} role={role} onOpen={setOpenId} />
    ) : (
      <RequestDetail
        api={api}
        id={openId}
        onBack={() => {
          setOpenId(null);
        }}
      />
    );
  if (roles.length === 1) {
    return (
      <section>
        <h2 className="section-title">{t(`tabs.${role}`)}</h2>
        {panel}
      </section>
    );
  }
  return (
    <section>
      <div role="tablist" aria-label={t('tabs.label')} className="tabs">
        {roles.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            id={`tab-${candidate}`}
            aria-selected={candidate === role}
            aria-controls="tab-panel"
            className="tab"
            onClick={() => {
              setSelectedRole(candidate);
              setOpenId(null);
            }}
          >
            {t(`tabs.${candidate}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="tab-panel" aria-labelledby={`tab-${role}`}>
        {panel}
      </div>
    </section>
  );
}
