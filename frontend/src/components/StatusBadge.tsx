import { useTranslation } from 'react-i18next';
import type { RequestStatus } from '../types';

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { t } = useTranslation();
  return <span className={`badge badge-${status.toLowerCase()}`}>{t(`status.${status}`)}</span>;
}
