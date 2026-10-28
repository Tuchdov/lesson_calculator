// Receipts share one financial transaction and one approval. Every resolved
// receipt must get a deadline, including duplicates confirmed after approval.
export async function scheduleResolvedPayloads(tx, now) {
  await tx.execute({
    sql: `UPDATE integration_payloads SET purge_after=COALESCE(purge_after,?)
      WHERE ciphertext IS NOT NULL AND id IN (
        SELECT e.id FROM payment_events e WHERE e.state IN ('confirmed','dismissed')
        AND NOT EXISTS(SELECT 1 FROM integration_jobs j WHERE j.event_id=e.id AND j.state!='done')
        AND (e.state='dismissed' OR (
          EXISTS(SELECT 1 FROM integration_jobs j JOIN payment_events sibling ON sibling.id=j.event_id
            WHERE sibling.payment_id=e.payment_id AND j.operation='approve' AND j.state='done')
          AND NOT EXISTS(SELECT 1 FROM integration_jobs j JOIN payment_events sibling ON sibling.id=j.event_id
            WHERE sibling.payment_id=e.payment_id AND j.operation='approve' AND j.state!='done')
        ))
      )`,
    args: [now + 86_400_000],
  })
}
