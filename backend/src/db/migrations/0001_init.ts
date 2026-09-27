import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE requests (
      id uuid PRIMARY KEY,
      short_id text NOT NULL UNIQUE,
      requester_id text NOT NULL CHECK (char_length(requester_id) BETWEEN 1 AND 128),
      requester_name text NOT NULL CHECK (char_length(requester_name) BETWEEN 1 AND 200),
      approver_id text NOT NULL CHECK (char_length(approver_id) BETWEEN 1 AND 128),
      approver_name text NOT NULL CHECK (char_length(approver_name) BETWEEN 1 AND 200),
      action text NOT NULL CHECK (action ~ '^[A-Z0-9_.:-]{1,64}$'),
      display_text text NOT NULL CHECK (char_length(display_text) BETWEEN 1 AND 500),
      context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context) = 'object'),
      authorization_duration_seconds integer NULL,
      status text NOT NULL
        CHECK (status IN ('PENDING', 'APPROVED', 'EXPIRED', 'CANCELLED', 'LOCKED')),
      code_hmac bytea NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL,
      idempotency_key text NULL UNIQUE,
      request_fingerprint bytea NOT NULL,
      created_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL,
      approved_at timestamptz NULL,
      cancelled_at timestamptz NULL,
      expired_at timestamptz NULL,
      locked_at timestamptz NULL,
      cancel_reason text NULL CHECK (char_length(cancel_reason) <= 500),
      CONSTRAINT requests_no_self_approval CHECK (requester_id <> approver_id),
      CONSTRAINT requests_expiry_after_creation CHECK (expires_at > created_at)
    )
  `.execute(db);
  await sql`CREATE INDEX requests_requester_idx ON requests (requester_id, created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX requests_approver_idx ON requests (approver_id, created_at DESC)`.execute(
    db,
  );
  await sql`CREATE INDEX requests_status_expiry_idx ON requests (status, expires_at)`.execute(db);

  await sql`
    CREATE TABLE request_events (
      id bigserial PRIMARY KEY,
      request_id uuid NOT NULL REFERENCES requests (id) ON DELETE CASCADE,
      type text NOT NULL CHECK (type IN (
        'CREATED', 'VERIFY_FAILED', 'APPROVED', 'EXPIRED', 'CANCELLED', 'LOCKED', 'VERIFY_REJECTED'
      )),
      at timestamptz NOT NULL,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb,
      prev_hash bytea NULL,
      hash bytea NOT NULL
    )
  `.execute(db);
  await sql`CREATE INDEX request_events_request_idx ON request_events (request_id, id)`.execute(db);

  // Append-only history: UPDATE is always refused; DELETE only when it comes from the
  // ON DELETE CASCADE of a purged request (nested trigger depth > 1).
  await sql`
    CREATE FUNCTION request_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'request_events is append-only';
      END IF;
      IF pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'request_events rows are only deleted with their request';
      END IF;
      RETURN OLD;
    END;
    $$
  `.execute(db);
  await sql`
    CREATE TRIGGER request_events_append_only
    BEFORE UPDATE OR DELETE ON request_events
    FOR EACH ROW EXECUTE FUNCTION request_events_append_only()
  `.execute(db);

  await sql`
    CREATE TABLE dashboard_handoffs (
      jti text PRIMARY KEY,
      used_at timestamptz NOT NULL,
      expires_at timestamptz NOT NULL
    )
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE dashboard_handoffs`.execute(db);
  await sql`DROP TABLE request_events`.execute(db);
  await sql`DROP FUNCTION request_events_append_only`.execute(db);
  await sql`DROP TABLE requests`.execute(db);
}
