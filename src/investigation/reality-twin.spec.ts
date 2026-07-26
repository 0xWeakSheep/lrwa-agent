import {
  computeFindings,
  createAgentTeam,
  createMorrowCase,
  generateEvidence,
  stableHash,
  verifyEvidenceHash,
} from './reality-twin';

describe('seeded Morrow reality twin', () => {
  const seed = 'repeatable-morrow';
  const investigationId = 'inv_test';
  const demoCase = createMorrowCase(seed);
  const agents = createAgentTeam(seed).filter(
    (agent) => agent.role !== 'SUPERVISOR',
  );

  it('repeats identical evidence and findings for the same seed', () => {
    const firstEvidence = generateEvidence(
      demoCase,
      investigationId,
      seed,
      agents,
    );
    const secondEvidence = generateEvidence(
      demoCase,
      investigationId,
      seed,
      agents,
    );
    expect(secondEvidence).toEqual(firstEvidence);

    const firstFindings = computeFindings(
      demoCase,
      investigationId,
      firstEvidence,
    );
    const secondFindings = computeFindings(
      demoCase,
      investigationId,
      secondEvidence,
    );
    expect(secondFindings).toEqual(firstFindings);
  });

  it('produces the canonical Morrow estimate from the 1,024-unit planned quota', () => {
    const evidence = generateEvidence(demoCase, investigationId, seed, agents);
    const findings = computeFindings(demoCase, investigationId, evidence);
    const monthlyClaim = demoCase.claims.find(
      (claim) => claim.metric === 'MONTHLY_GMV',
    );
    const monthlyFinding = findings.find(
      (finding) => finding.claimId === monthlyClaim?.id,
    );
    const storeEvidence = evidence.find(
      (item) => item.source.family === 'STORE_OBSERVATION',
    );

    expect(demoCase.claims.map((claim) => claim.reportedValue)).toEqual([
      48, 118, 19.6, 3_330_000,
    ]);
    expect(demoCase.stores).toHaveLength(48);
    expect(evidence.reduce((sum, item) => sum + item.sampleSize, 0)).toBe(1024);
    expect(
      storeEvidence?.storeSignals?.filter(
        (signal) => signal.observedStatus === 'ACTIVE',
      ),
    ).toHaveLength(39);
    expect(monthlyFinding).toMatchObject({
      verdict: 'UNSUPPORTED',
      estimatedValue: 1_920_000,
      lowerBound: 1_720_000,
      upperBound: 2_140_000,
      gapPercent: 42.3,
      confidence: 0.88,
    });
  });

  it('raises GMV and widens uncertainty under the caller-confirmed hypothesis', () => {
    const baseEvidence = generateEvidence(
      demoCase,
      investigationId,
      seed,
      agents,
    );
    const replayEvidence = generateEvidence(
      demoCase,
      `${investigationId}_replay`,
      seed,
      agents,
      0.2,
    );
    const baseFinding = computeFindings(
      demoCase,
      investigationId,
      baseEvidence,
    ).find((finding) => finding.reportedValue === 3_330_000);
    const replayFinding = computeFindings(
      demoCase,
      `${investigationId}_replay`,
      replayEvidence,
      0.2,
    ).find((finding) => finding.reportedValue === 3_330_000);

    expect(replayFinding?.estimatedValue).toBe(2_400_000);
    expect(replayFinding?.estimatedValue).toBeGreaterThan(
      baseFinding?.estimatedValue ?? 0,
    );
    expect(replayFinding?.gapPercent).toBeLessThan(
      baseFinding?.gapPercent ?? 0,
    );
    expect(
      (replayFinding?.upperBound ?? 0) - (replayFinding?.lowerBound ?? 0),
    ).toBeGreaterThan(
      (baseFinding?.upperBound ?? 0) - (baseFinding?.lowerBound ?? 0),
    );
    expect(replayFinding?.verdict).toBe('UNSUPPORTED');
  });

  it('keeps every finding traceable to hashed SIMULATED evidence', () => {
    const evidence = generateEvidence(demoCase, investigationId, seed, agents);
    const findings = computeFindings(demoCase, investigationId, evidence);

    for (const item of evidence) {
      const { hash, ...payload } = item;
      expect(item.source.label).toBe('SIMULATED');
      expect(item.agent.id).toBeTruthy();
      expect(item.agent.role).toBeTruthy();
      expect(item.tool).toBeTruthy();
      expect(hash).toBe(stableHash(payload));
      expect(verifyEvidenceHash(item)).toBe(true);
    }

    for (const finding of findings) {
      expect(finding.evidenceIds.length).toBeGreaterThanOrEqual(2);
      for (const evidenceId of finding.evidenceIds) {
        expect(evidence.some((item) => item.id === evidenceId)).toBe(true);
      }
      if (finding.confidenceBand === 'HIGH') {
        expect(finding.evidenceFamilies.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('rejects a receipt whose hashed payload was changed', () => {
    const [evidence] = generateEvidence(
      demoCase,
      investigationId,
      seed,
      agents,
    );
    const tampered = {
      ...evidence,
      measurements: {
        ...evidence.measurements,
        estimatedMonthlyGmv: 9_999_999,
      },
    };

    expect(verifyEvidenceHash(tampered)).toBe(false);
  });
});
