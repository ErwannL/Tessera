import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { EMPTY_FILTERS, STATUSES, type Filters, type RequestStatus } from '../types';

export interface FiltersFormProps {
  onApply: (filters: Filters) => void;
}

/** Narrows the list; submitting only changes what is displayed. */
export function FiltersForm({ onApply }: FiltersFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const update = (patch: Partial<Filters>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onApply({
      ...draft,
      action: draft.action.trim().toUpperCase(),
      counterpart: draft.counterpart.trim(),
    });
  };
  const reset = () => {
    setDraft(EMPTY_FILTERS);
    onApply(EMPTY_FILTERS);
  };
  return (
    <form className="filters" aria-label={t('filters.title')} onSubmit={submit}>
      <label>
        <span>{t('filters.status')}</span>
        <select
          value={draft.status}
          onChange={(event) => {
            update({ status: event.target.value as RequestStatus | '' });
          }}
        >
          <option value="">{t('filters.anyStatus')}</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('filters.action')}</span>
        <input
          value={draft.action}
          onChange={(event) => {
            update({ action: event.target.value });
          }}
        />
      </label>
      <label>
        <span>{t('filters.from')}</span>
        <input
          type="date"
          value={draft.from}
          onChange={(event) => {
            update({ from: event.target.value });
          }}
        />
      </label>
      <label>
        <span>{t('filters.to')}</span>
        <input
          type="date"
          value={draft.to}
          onChange={(event) => {
            update({ to: event.target.value });
          }}
        />
      </label>
      <label>
        <span>{t('filters.counterpart')}</span>
        <input
          value={draft.counterpart}
          onChange={(event) => {
            update({ counterpart: event.target.value });
          }}
        />
      </label>
      <div className="filters-actions">
        <button type="submit" className="button primary">
          {t('filters.apply')}
        </button>
        <button type="button" className="button" onClick={reset}>
          {t('filters.reset')}
        </button>
      </div>
    </form>
  );
}
