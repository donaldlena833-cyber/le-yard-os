'use client';
import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceContext } from '@/components/providers/workspace-provider';
import { learningDay, type LearningRecord } from '@/lib/learning/model';
export function useLearning(){
  const workspace = useWorkspaceContext();
  const [records,setRecords] = useState<LearningRecord[]>([]);
  const [date,setDate] = useState(learningDay(workspace.activeLocation.timeZone ?? "America/New_York"));
  const [loading,setLoading] = useState(workspace.mode === 'live');
  const [error,setError] = useState('');
  const canEdit = ['owner','admin','manager'].includes(workspace.role);
  const refresh = useCallback(async()=>{
    if(workspace.mode !== 'live') return;
    const response = await fetch('/api/workspace/learning',{cache:'no-store'});
    const body = await response.json();
    if(!response.ok) throw new Error(body.message || 'Could not load.');
    setRecords(body.records);setDate(body.date);setError('');
  },[workspace.mode]);
  useEffect(()=>{let active=true; const kickoff=setTimeout(()=>{void refresh().catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});},0);const interval=setInterval(()=>{if(document.visibilityState==='visible')void refresh().catch(()=>{});},30000);return()=>{active=false;clearTimeout(kickoff);clearInterval(interval);};},[refresh,workspace.organization.id,workspace.activeLocation.id,workspace.identity.userId]);
  const save = async(input:Record<string,unknown>)=>{
    setError('');
    if(workspace.mode !== 'live') {throw new Error('Preview only. Open the live workspace to save.');}
    const response = await fetch('/api/workspace/learning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const body = await response.json();
    if(!response.ok) throw new Error(body.message || 'Could not save.');
    await refresh(); return body;
  };
  return {workspace,records,date,loading,error,setError,refresh,save,canEdit};
}
