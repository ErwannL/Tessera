import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Api } from '../api';
import { formatDateTime } from '../format';
import type { Detail } from '../types';
import { StatusBadge } from './StatusBadge';

type DetailState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; detail: Detail };

export interface RequestDetailProps {
  api: Api;
  id: string;
  onBack: () => void;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  const { t, i18n } = useTranslation();
  const { request, events, chainValid } = detail;
  const date = (iso: string | null) =>
    iso === null ? t('detail.none') : formatDateTime(iso, i18n.language);
  return (
    <>
      <h2>{t('detail.title', { shortId: request.shortId })}</h2>
      <section aria-labelledby="fields-title">
        <h3 id="fields-title">{t('detail.fields')}</h3>
        <dl className="fields">
          <Field label={t('detail.status')}>
            <StatusBadge status={request.status} />
          </Field>
          <Field
            label={t('detail.requester')}
          >{`${request.requester.name} (${request.requester.id})`}</Field>
          <Field
            label={t('detail.approver')}
          >{`${request.approver.name} (${request.approver.id})`}</Field>
          <Field label={t('detail.action')}>
            <code>{request.action}</code>
          </Field>
          <Field label={t('detail.displayText')}>{request.displayText}</Field>
          <Field label={t('detail.createdAt')}>{date(request.createdAt)}</Field>
          <Field label={t('detail.expiresAt')}>{date(request.expiresAt)}</Field>
          <Field label={t('detail.approvedAt')}>{date(request.approvedAt)}</Field>
          <Field label={t('detail.cancelledAt')}>{date(request.cancelledAt)}</Field>
          <Field label={t('detail.expiredAt')}>{date(request.expiredAt)}</Field>
          <Field label={t('detail.lockedAt')}>{date(request.lockedAt)}</Field>
          <Field label={t('detail.cancelReason')}>{request.cancelReason ?? t('detail.none')}</Field>
          <Field label={t('detail.attempts')}>
            {t('detail.attemptsValue', { attempts: request.attempts, max: request.maxAttempts })}
          </Field>
          <Field label={t('detail.duration')}>
            {request.authorizationDurationSeconds === null
              ? t('detail.none')
              : t('detail.durationValue', { count: request.authorizationDurationSeconds })}
          </Field>
        </dl>
      </section>
      <section aria-labelledby="context-title">
        <h3 id="context-title">{t('detail.context')}</h3>
        <pre className="context">{JSON.stringify(request.context, null, 2)}</pre>
      </section>
      <section aria-labelledby="history-title">
        <h3 id="history-title">{t('detail.history')}</h3>
        <p className={chainValid ? 'integrity ok' : 'integrity broken'} role="status">
          {chainValid ? t('detail.chainValid') : t('detail.chainBroken')}
        </p>
        <ol className="events">
          {events.map((event) => (
            <li key={event.id}>
              <time dateTime={event.at}>{formatDateTime(event.at, i18n.language)}</time>
              <span>{t(`event.${event.type}`, { defaultValue: event.type })}</span>
            </li>
          ))}
        </ol>
        <p className="muted small">{t('detail.trace')}</p>
      </section>
    </>
  );
}

export function RequestDetail({ api, id, onBack }: RequestDetailProps) {
  const { t } = useTranslation();
  const [state, setState] = useState<DetailState>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    api.detail(id).then(
      (detail) => {
        if (active) setState({ kind: 'ready', detail });
      },
      () => {
        if (active) setState({ kind: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [api, id]);

  return (
    <article className="detail">
      <button type="button" className="button" onClick={onBack}>
        {t('detail.back')}
      </button>
      {state.kind === 'loading' && <p className="muted">{t('app.loading')}</p>}
      {state.kind === 'error' && (
        <p role="alert" className="error">
          {t('app.error')}
        </p>
      )}
      {state.kind === 'ready' && <DetailView detail={state.detail} />}
    </article>
  );
}
