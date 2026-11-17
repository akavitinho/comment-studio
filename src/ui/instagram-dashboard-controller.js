(function(scope) {
  class InstagramDashboardController {
    constructor({ api, onChange = () => {} }) {
      this.api=api;this.onChange=onChange;this.selectionKey='';this.readSequence=0;
      this.lastRequestedAt=0;this.lastRequestedKey='';
      this.collection=null;this.submitting=false;this.jobs=new Map();this.error='';this.visible=true;
    }
    select(key, request) {
      if(key!==this.selectionKey){this.selectionKey=key;this.readSequence++;this.collection=null;this.submitting=false;this.error='';}
      this.visible=true;this.request={...request,selectionKey:key};
    }
    deactivate(){this.visible=false;this.readSequence++;}
    get busy(){return this.submitting||Boolean(this.collection&&!['complete','failed','superseded','interrupted'].includes(this.collection.status)&&!['background-complete','failed','superseded','interrupted'].includes(this.collection.phase));}
    accept(progress, notify=true) {
      if(!progress?.refreshId)return false;
      const previous=this.jobs.get(progress.refreshId);
      if(previous && (previous.sequence||0)>(progress.sequence||0))return false;
      const value={...previous,...progress};this.jobs.set(value.refreshId,value);
      if(this.jobs.size>40)this.jobs.delete(this.jobs.keys().next().value);
      if(value.selectionKey!==this.selectionKey)return false;
      if(this.collection?.refreshId!==value.refreshId && (this.collection?.startedAt||0)>(value.startedAt||0))return false;
      this.collection=value;
      if(notify&&this.visible)this.onChange();
      return true;
    }
    hydrate(collections){
      if(!collections)return;
      for(const job of [collections.last,collections.active,collections.queued])this.accept(job,false);
    }
    async read(query){
      const sequence=++this.readSequence,key=this.selectionKey;
      try {
        const data=await this.api.instagramOfficialMetrics(query);
        if(!this.visible||sequence!==this.readSequence||key!==this.selectionKey)return null;
        this.hydrate(data.collections);return data;
      } catch(error){if(this.visible&&sequence===this.readSequence){this.error=error.message;throw error;}return null;}
    }
    async refresh(force=false){
      if(this.busy||!this.request?.accountIds.length)return null;
      const key=this.selectionKey;this.lastRequestedAt=Date.now();this.lastRequestedKey=key;this.submitting=true;this.error='';this.onChange();
      try{
        const result=await this.api.refreshInstagramInsights({...this.request,force});
        const known=this.jobs.get(result.refreshId);
        this.accept(known||{refreshId:result.refreshId,selectionKey:result.selectionKey||key,startedAt:result.startedAt,phase:result.queued?'queued':'started',status:'running',sequence:0},false);
        return result;
      }catch(error){if(key===this.selectionKey)this.error=error.message;return null;}
      finally{if(key===this.selectionKey){this.submitting=false;this.onChange();}}
    }
    label(){
      if(this.error)return this.error;
      const job=this.collection;if(!job)return this.submitting?'Consultando…':'';
      if(job.phase==='queued')return 'Aguardando coleta anterior…';
      if(job.phase==='official-ready')return `Totais: ${job.accountsProcessed}/${job.accountsTotal} contas`;
      if(job.phase==='accounts')return `Histórico: ${job.completed}/${job.total} dias`;
      if(job.phase==='reels')return `Reels: ${job.processed}/${job.total}`;
      if(job.phase==='background-complete')return job.failures?.length?'Atualização parcial · veja os detalhes':'Atualização concluída';
      if(job.phase==='failed')return 'Falha na atualização · veja os detalhes';
      if(['interrupted','superseded'].includes(job.phase))return 'Coleta interrompida';
      return 'Atualizando…';
    }
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={InstagramDashboardController};else scope.InstagramDashboardController=InstagramDashboardController;
})(typeof window==='undefined'?globalThis:window);
