CREATE TABLE billing_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL DEFAULT 'recovery' CHECK (mode IN ('normal', 'recovery')),
  environment TEXT CHECK(environment IN ('sandbox','production')),
  merchant TEXT,
  checkpoint TEXT,
  signed_off_at TEXT
);
INSERT INTO billing_control(id) VALUES(1);

CREATE TABLE students (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  hold TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, id)
);
CREATE TABLE student_aliases (
  owner_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  student_id TEXT NOT NULL,
  PRIMARY KEY(owner_id, alias),
  FOREIGN KEY(owner_id, student_id) REFERENCES students(owner_id, id)
);
CREATE TABLE legacy_links (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  month TEXT NOT NULL,
  url TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot > 0),
  reviewed INTEGER NOT NULL DEFAULT 0 CHECK(reviewed IN (0,1)),
  evidence TEXT,
  FOREIGN KEY(owner_id, student_id) REFERENCES students(owner_id,id)
);
CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  month TEXT NOT NULL,
  charge_agorot INTEGER NOT NULL CHECK(charge_agorot >= 0 AND charge_agorot <= 100000000),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
  version INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL DEFAULT 'lessons',
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, student_id, month),
  UNIQUE(owner_id, student_id, id),
  FOREIGN KEY(owner_id, student_id) REFERENCES students(owner_id, id)
);
CREATE TABLE invoice_adjustments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  agorot INTEGER NOT NULL,
  target_agorot INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_id, student_id, invoice_id) REFERENCES invoices(owner_id, student_id, id)
);
CREATE TABLE payment_requests (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  revision INTEGER NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot > 0),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
  month TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('dispatching','ready','unknown','needs_review','cancelled','completed')),
  holds_slot INTEGER NOT NULL DEFAULT 1 CHECK(holds_slot IN (0,1)),
  url TEXT,
  provider TEXT NOT NULL DEFAULT 'grow',
  environment TEXT NOT NULL,
  merchant TEXT NOT NULL,
  process_id TEXT,
  process_token TEXT,
  conflict_result TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, request_id),
  UNIQUE(provider, environment, merchant, process_id),
  UNIQUE(owner_id, student_id, id),
  FOREIGN KEY(owner_id, student_id) REFERENCES students(owner_id, id)
);
CREATE UNIQUE INDEX one_active_request ON payment_requests(owner_id, student_id) WHERE holds_slot = 1;
CREATE TABLE request_items (
  request_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  agorot INTEGER NOT NULL CHECK(agorot > 0),
  invoice_version INTEGER NOT NULL,
  PRIMARY KEY(request_id, invoice_id),
  FOREIGN KEY(owner_id, student_id, request_id) REFERENCES payment_requests(owner_id, student_id, id),
  FOREIGN KEY(owner_id, student_id, invoice_id) REFERENCES invoices(owner_id, student_id, id)
);
CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('grow','cash','bank')),
  identity TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot > 0 AND amount_agorot <= 100000000),
  currency TEXT NOT NULL DEFAULT 'ILS' CHECK(currency='ILS'),
  evidence TEXT NOT NULL,
  details_hash TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, identity),
  UNIQUE(owner_id, student_id, id),
  FOREIGN KEY(owner_id, student_id) REFERENCES students(owner_id, id),
  FOREIGN KEY(owner_id, student_id, request_id) REFERENCES payment_requests(owner_id, student_id, id)
);
CREATE TABLE payment_reversals (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  agorot INTEGER NOT NULL CHECK(agorot > 0),
  action_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(owner_id, action_id),
  FOREIGN KEY(owner_id, student_id, payment_id) REFERENCES payments(owner_id, student_id, id)
);
CREATE TABLE payment_allocations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  agorot INTEGER NOT NULL CHECK(agorot != 0),
  reverses_id TEXT REFERENCES payment_allocations(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_id, student_id, payment_id) REFERENCES payments(owner_id, student_id, id),
  FOREIGN KEY(owner_id, student_id, invoice_id) REFERENCES invoices(owner_id, student_id, id)
);
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'grow',
  environment TEXT NOT NULL,
  merchant TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  process_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  status_code TEXT NOT NULL,
  amount_agorot INTEGER NOT NULL CHECK(amount_agorot > 0),
  supported INTEGER NOT NULL DEFAULT 1 CHECK(supported IN (0,1)),
  state TEXT NOT NULL DEFAULT 'reported' CHECK(state IN ('reported','confirmed','quarantined','needs_review','dismissed')),
  request_id TEXT REFERENCES payment_requests(id),
  payment_id TEXT REFERENCES payments(id),
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, environment, merchant, fingerprint)
);
CREATE TABLE integration_payloads (
  id TEXT PRIMARY KEY REFERENCES payment_events(id),
  ciphertext TEXT,
  expires_at INTEGER NOT NULL,
  purge_after INTEGER,
  purged_at INTEGER
);
CREATE TABLE payment_event_resolutions (
  event_id TEXT PRIMARY KEY REFERENCES payment_events(id),
  owner_id TEXT NOT NULL,
  evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE integration_jobs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK(operation IN ('verify','approve')),
  event_id TEXT NOT NULL REFERENCES payment_events(id),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','done','needs_review')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  UNIQUE(operation, event_id)
);
CREATE VIEW invoice_balances AS
SELECT i.*, i.charge_agorot + COALESCE((SELECT SUM(a.agorot) FROM invoice_adjustments a WHERE a.invoice_id=i.id),0) AS total_agorot,
  COALESCE((SELECT SUM(p.agorot) FROM payment_allocations p WHERE p.invoice_id=i.id),0) AS paid_agorot
FROM invoices i;
CREATE VIEW payment_balances AS
SELECT p.*, p.amount_agorot - COALESCE((SELECT SUM(r.agorot) FROM payment_reversals r WHERE r.payment_id=p.id),0) AS net_agorot,
  COALESCE((SELECT SUM(a.agorot) FROM payment_allocations a WHERE a.payment_id=p.id),0) AS allocated_agorot
FROM payments p;
CREATE INDEX invoices_by_owner ON invoices(owner_id, month);
CREATE INDEX events_by_process ON payment_events(environment, merchant, process_id);
CREATE INDEX jobs_due ON integration_jobs(state, next_attempt);
