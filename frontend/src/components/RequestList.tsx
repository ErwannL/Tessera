import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../api';
import { EMPTY_FILTERS, type Filters, type RequestView, type Role } from '../types';
import { FiltersForm } from './FiltersForm';
import { RequestRow } from './RequestRow';

type ListState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: RequestView[]; nextCursor: string | null; loadingMore: boolean };

function MoreButton({
  state,
  onMore,
}: {
  state: Extract<ListState, { kind: 'ready' }>;
  onMore: (items: RequestView[], cursor: string) => void;
}) {
  const { t } = useTranslation();
  const { items, nextCursor } = state;
  if (nextCursor === null) return null;
  return (
    <button
      type="button"
      className="button more"
      disabled={state.loadingMore}
      onClick={() => {
        onMore(items, nextCursor);
      }}
    >
      {t('list.more')}
    </button>
  );
}

export interface RequestListProps {
  api: Api;
  role: Role;
  onOpen: (id: string) => void;
}

export function RequestList({ api, role, onOpen }: RequestListProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api.list(role, filters, null).then(
      (page) => {
        if (active) setState({ kind: 'ready', ...page, loadingMore: false });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [api, role, filters, attempt]);

  const loadMore = (items: RequestView[], cursor: string) => {
    setState({ kind: 'ready', items, nextCursor: cursor, loadingMore: true });
    api.list(role, filters, cursor).then(
      (page) => {
        setState({
          kind: 'ready',
          items: [...items, ...page.items],
          nextCursor: page.nextCursor,
          loadingMore: false,
        });
      },
      () => {
        setState({ kind: 'error' });
      },
    );
  };

  const filtered = Object.values(filters).some((value) => value !== '');
  return (
    <section className="list">
      <FiltersForm
        onApply={(next) => {
          setState({ kind: 'loading' });
          setFilters(next);
        }}
      />
      {state.kind === 'loading' && <p className="muted">{t('app.loading')}</p>}
      {state.kind === 'error' && (
        <p role="alert" className="error">
          {t('app.error')}{' '}
          <button
            type="button"
            className="link"
            onClick={() => {
              setState({ kind: 'loading' });
              setAttempt((value) => value + 1);
            }}
          >
            {t('app.retry')}
          </button>
        </p>
      )}
      {state.kind === 'ready' && (
        <>
          {state.items.length === 0 ? (
            <p className="muted">{filtered ? t('empty.filtered') : t('empty.none')}</p>
          ) : (
            <ul className="rows">
              {state.items.map((request) => (
                <RequestRow key={request.id} request={request} role={role} onOpen={onOpen} />
              ))}
            </ul>
          )}
          <MoreButton state={state} onMore={loadMore} />
        </>
      )}
    </section>
  );
}
