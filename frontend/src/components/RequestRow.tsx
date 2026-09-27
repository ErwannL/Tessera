import { useTranslation } from 'react-i18next';
import { formatDate } from '../format';
import type { RequestStatus, RequestView, Role } from '../types';
import { Countdown } from './Countdown';
import { StatusBadge } from './StatusBadge';

type Closed = Exclude<RequestStatus, 'PENDING'>;

const CLOSING: Record<Closed, { key: string; field: keyof RequestView }> = {
  APPROVED: { key: 'list.approvedAt', field: 'approvedAt' },
  CANCELLED: { key: 'list.cancelledAt', field: 'cancelledAt' },
  EXPIRED: { key: 'list.expiredAt', field: 'expiredAt' },
  LOCKED: { key: 'list.lockedAt', field: 'lockedAt' },
};

function ClosingDate({ request }: { request: RequestView & { status: Closed } }) {
  const { t, i18n } = useTranslation();
  const { key, field } = CLOSING[request.status];
  const date = request[field] as string | null;
  return (
    <span>
      {date === null
        ? t(`status.${request.status}`)
        : t(key, { date: formatDate(date, i18n.language) })}
    </span>
  );
}

export interface RequestRowProps {
  request: RequestView;
  role: Role;
  onOpen: (id: string) => void;
}

export function RequestRow({ request, role, onOpen }: RequestRowProps) {
  const { t, i18n } = useTranslation();
  const counterpart =
    role === 'requester'
      ? t('list.to', { name: request.approver.name })
      : t('list.from', { name: request.requester.name });
  return (
    <li className="row">
      <button
        type="button"
        className="row-button"
        aria-label={t('list.open', { shortId: request.shortId })}
        onClick={() => {
          onOpen(request.id);
        }}
      >
        <span className="row-head">
          <span className="short-id">{request.shortId}</span>
          <span className="counterpart">{counterpart}</span>
          <StatusBadge status={request.status} />
        </span>
        <span className="action">{request.action}</span>
        <span className="display-text">{request.displayText}</span>
        <span className="row-meta">
          <span>{t('list.createdAt', { date: formatDate(request.createdAt, i18n.language) })}</span>
          {request.status === 'PENDING' ? (
            <Countdown expiresAt={request.expiresAt} />
          ) : (
            <ClosingDate request={request as RequestView & { status: Closed }} />
          )}
        </span>
      </button>
    </li>
  );
}
