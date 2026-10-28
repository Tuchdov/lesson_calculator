ALTER TABLE payment_events ADD COLUMN forwarding_authenticated INTEGER NOT NULL DEFAULT 0 CHECK(forwarding_authenticated IN (0,1));
CREATE INDEX events_by_intake ON payment_events(environment, merchant, forwarding_authenticated, request_id, state);
