/* eslint-disable @typescript-eslint/no-require-imports -- Isolated draft generation and transactional persistence regression test. */
require('tsx/cjs');
const assert=require('node:assert/strict'),Module=require('node:module'),original=Module._load;
const touch={id:'touch',clientId:'client',scheduledLocalDate:'2026-11-18',followThrough:{score:{confirmedAt:'confirmed'},notes:{departments:[{department:'SEO',clientFeedback:'Check visibility',actions:[{id:'a1',what:'Review location visibility',team:'SEO',due:'',assignee:'Named owner'},{id:'a2',what:'Review service page',team:'SEO',due:''}]}],pending:[]},items:[]}};
const db={doc:()=>({get:async()=>({exists:true,data:()=>({SEO:'Configured SEO owner'})})}),runTransaction:async fn=>fn({get:async()=>({data:()=>touch}),update:(_ref,fields)=>{if(fields['followThrough.items'])touch.followThrough.items=fields['followThrough.items'];}})};
Module._load=function(request,parent,...rest){if(parent?.filename.match(/follow-through-(items|drafts)-service\.ts$/)){
 if(request==='@/src/lib/server/firebase/admin')return {getFirebaseAdminDb:()=>db};
 if(request==='@/src/lib/server/data/seed-mtos-data-source')return {getMtosDataSource:()=>({getMonthlyTouchById:async()=>touch,getClientById:async()=>({name:'Synthetic client'})})};
 if(request==='@/src/lib/server/firebase/quota')return {withQuotaFallback:async(_label,_fallback,fn)=>fn()};
 if(request==='@/src/lib/server/services/mtos-ai')return {stripUndefinedDeep:v=>v};
}return original.call(this,request,parent,...rest);};
(async()=>{try{
 const {buildFollowThroughItems}=require('../src/lib/server/services/follow-through-items-service.ts');
 const {persistGeneratedFollowThroughDraft}=require('../src/lib/server/services/follow-through-drafts-service.ts');
 const context={tenantId:'synthetic',userId:'am'};
 let result=await buildFollowThroughItems(context,'touch');assert.equal(result.items.length,2);assert.equal(result.items[0].department,'SEO');assert.equal(result.items[0].assignee,'Named owner');assert.equal(result.items[1].assignee,'Configured SEO owner');
 await persistGeneratedFollowThroughDraft(context,'touch','items',result.items);assert.equal(touch.followThrough.items.length,2);
 touch.followThrough.items[0].decision='approved';touch.followThrough.items[0].assignee='AM edited owner';
 touch.followThrough.notes.departments[0].actions.push({id:'a3',what:'Check second location',team:'SEO',due:''});
 result=await buildFollowThroughItems(context,'touch');
 await persistGeneratedFollowThroughDraft(context,'touch','items',result.items);
 await persistGeneratedFollowThroughDraft(context,'touch','items',result.items);
 assert.equal(touch.followThrough.items.length,3);assert.equal(touch.followThrough.items[0].assignee,'AM edited owner');assert.equal(touch.followThrough.items[0].decision,'approved');
 console.log('PASS department action tickets, named/configured owners, empty-list recovery, missing-ticket merge, reviewed-draft preservation and duplicate prevention');
}finally{Module._load=original;}})().catch(error=>{console.error(error);process.exitCode=1;});
