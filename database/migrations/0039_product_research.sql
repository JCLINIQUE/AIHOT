-- Internal Amazon US research runs. These tables are never read by the public publication layer.
CREATE TABLE research_runs (
  id                text PRIMARY KEY,
  input_type        text NOT NULL CHECK (input_type IN ('keyword', 'asin')),
  query             text NOT NULL,
  original_task     text NOT NULL,
  marketplace       text NOT NULL DEFAULT 'US' CHECK (marketplace = 'US'),
  created_by        text NOT NULL,
  idempotency_key   text NOT NULL UNIQUE,
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'partial', 'failed')),
  step              text,
  progress          jsonb NOT NULL DEFAULT '{}',
  products          jsonb NOT NULL DEFAULT '[]',
  report            jsonb,
  prompt_version    text,
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX research_runs_created_idx ON research_runs (created_at DESC);
CREATE INDEX research_runs_status_idx ON research_runs (status, created_at) WHERE status IN ('queued', 'running');

CREATE TABLE research_evidence (
  id             bigserial PRIMARY KEY,
  run_id         text NOT NULL REFERENCES research_runs (id) ON DELETE CASCADE,
  evidence_key   text NOT NULL,
  provider       text NOT NULL CHECK (provider IN ('xiyou')),
  tool           text NOT NULL,
  subject        text NOT NULL,
  asin           text,
  request        jsonb NOT NULL DEFAULT '{}',
  metrics        jsonb NOT NULL DEFAULT '{}',
  data_window    text,
  queried_at     timestamptz NOT NULL DEFAULT now(),
  source_url     text,
  receipt_id     bigint REFERENCES receipts (id),
  UNIQUE (run_id, evidence_key)
);

CREATE INDEX research_evidence_run_idx ON research_evidence (run_id, id);

INSERT INTO budgets (service, per_minute, per_hour, per_day, note) VALUES
  ('xiyou-mcp', 10, 100, 500, 'Amazon 商品调研 MCP 调用熔断')
ON CONFLICT (service) DO NOTHING;
