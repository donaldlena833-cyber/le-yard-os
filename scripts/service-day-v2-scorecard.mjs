export function buildConnectedServiceDayScorecard({requiredPhases, phases, checks, issues, scopeGaps}) {
  const byCheck=new Map(checks.map(c=>[c.id,c]));
  const duplicateChecks=checks.filter((c,index)=>checks.findIndex(other=>other.id===c.id)!==index).map(c=>c.id);
  const usedEvidence=new Set(),reusedEvidence=[];
  const missingPhases=requiredPhases.filter(id=>{
    const matches=phases.filter(p=>p.id===id);
    if(matches.length!==1||matches[0].status!=='completed')return true;
    const ids=matches[0].checkIds;
    if(!Array.isArray(ids)||ids.length===0||ids.some(key=>!byCheck.has(key)))return true;
    for(const key of ids){if(usedEvidence.has(key))reusedEvidence.push(key);usedEvidence.add(key);}
    return false;
  });
  const failedChecks=checks.filter(c=>c.passed!==true).map(c=>c.id);
  const failedPhases=phases.filter(p=>p.status!=='completed').map(p=>p.id);
  const emptyEvidence=checks.length===0;
  const unresolved=issues.filter(i=>i.status!=='resolved');
  const unowned=unresolved.filter(i=>!i.ownerId||!i.dueAt||!i.nextAction);
  const mechanicalFailed=missingPhases.length>0||failedPhases.length>0||failedChecks.length>0||duplicateChecks.length>0||reusedEvidence.length>0||emptyEvidence;
  return {
    mechanicalStatus:mechanicalFailed?'failed':'passed',
    missingOrFailedPhases:[...new Set([...missingPhases,...failedPhases])],failedChecks,
    duplicateCheckIds:duplicateChecks,reusedPhaseEvidence:reusedEvidence,
    operationalStatus:mechanicalFailed?'incomplete':unresolved.length||unowned.length?'needs_follow_up':'locally_reconciled',
    unresolvedIssues:unresolved.map(i=>({id:i.id,status:i.status,ownerId:i.ownerId??null,dueAt:i.dueAt??null,nextAction:i.nextAction??null})),
    unownedIssues:unowned.map(i=>i.id),
    releaseAccepted:false,
    remainingAcceptance:[...scopeGaps],
    timing:'Actual command observations in a compressed sequence; planned meal times are not observed restaurant elapsed time',
  };
}
