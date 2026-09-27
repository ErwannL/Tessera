import { useTranslation } from 'react-i18next';
import { formatRemaining } from '../format';
import { useNow } from '../useNow';

export function Countdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation();
  const remaining = Date.parse(expiresAt) - useNow(1000);
  return (
    <span className="countdown">
      {remaining > 0 ? t('list.expiresIn', { time: formatRemaining(remaining) }) : t('list.due')}
    </span>
  );
}
