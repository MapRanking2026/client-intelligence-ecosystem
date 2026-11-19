/* eslint-disable @typescript-eslint/no-require-imports -- Synthetic service test with model, transcript and storage isolated. */
require('tsx/cjs');const assert=require('node:assert/strict'),Module=require('node:module'),original=Module._load;
let outputs=[],prompts=[],writes=0;
const touch={id:'touch',clientId:'client',scheduledAt:'2026-11-18T18:00:00Z',transcript:{foundAt:'2026-11-18T19:00:00Z'},followThrough:{score:{confirmedAt:'2026-11-18T19:10:00Z',score:8,findings:[]},notes:{summary:'Previously saved AM notes.'}}};
const mocks={
 '@/src/lib/server/data/seed-mtos-data-source':{getMtosDataSource:()=>({getMonthlyTouchById:async()=>touch,getClientById:async()=>({id:'client',name:'Synthetic client',goals:[]}),getMonthlyTouches:async()=>[touch],getCommitments:async()=>[]})},
 '@/src/lib/server/services/user-service':{getAccountManagerProfile:async()=>({name:'Synthetic AM'})},
 '@/src/lib/server/services/transcript-watch-service':{readTouchTranscriptPayload:async()=> 'Synthetic call: categories completed; SEO to review the service page, with no date agreed.'},
 '@/src/lib/server/env':{getServerEnv:()=>({})},
 '@/src/lib/server/prompt-store':{getPromptText:async()=> 'Return notes JSON using the existing notes contract.'},
 '@/src/lib/server/services/mtos-ai':{getNowIso:()=> '2026-11-18T20:00:00Z',hasAnyLlmProvider:()=>true,callLlmForJson:async options=>{prompts.push(options.userText);return {data:outputs.shift()};}},
 '@/src/lib/server/firebase/admin':{getFirebaseAdminDb:()=>({doc:()=>({set:async()=>{writes++;}})})}
};
Module._load=function(request,parent,...rest){if(parent?.filename.endsWith('follow-through-notes-service.ts')&&mocks[request])return mocks[request];return original.call(this,request,parent,...rest);};
(async()=>{try{
 const {parseNotesOutput}=require('../src/lib/contracts/follow-through-notes-output.ts');
 const {draftFollowThroughNotes}=require('../src/lib/server/services/follow-through-notes-service.ts');
 const valid={summary:'The call reviewed completed categories.',bullets:{metrics:'Not established in the available call evidence.',delivery:'Categories completed.',posture:'Not established in the available call evidence.',requests:'Not established in the available call evidence.',nextTouch:'Not established in the available call evidence.',sentiment:'Not established in the available call evidence.'},goalText:null,goalStatus:null,goalEvidence:null,departments:[{department:'SEO',clientFeedback:null,actions:[{what:'Review the service page',team:null,due:null,carryOver:null,crossDepartment:null,dependsOn:null}]}],clientActions:null,pending:null};
 assert.equal(parseNotesOutput(valid).success,true);assert.equal(parseNotesOutput({notes:valid}).success,true);
 assert.equal(parseNotesOutput({...valid,departments:[{department:'SEO',actions:[{what:null}]}]}).success,false);
 touch.postMeeting={analyzedAt:'2026-11-19T19:00:00Z',recapSummary:'Legacy recap with every category mixed together.',draftTickets:[]};
 outputs=[valid];let result=await draftFollowThroughNotes({tenantId:'synthetic',userId:'am'},'touch');assert.equal(result.notes.summary,valid.summary);assert.equal(result.notes.departments[0].actions[0].due,'');assert.equal(prompts.length,1);
 outputs=[{...valid,departments:[{department:'SEO',actions:[{what:null}]}]},valid];prompts=[];
 result=await draftFollowThroughNotes({tenantId:'synthetic',userId:'am'},'touch');assert.equal(prompts.length,2);assert.ok(prompts[1].includes('departments.0.actions.0.what'));assert.equal(result.notes.departments[0].actions[0].what,'Review the service page');
 outputs=[{...valid,bullets:{}},valid];prompts=[];result=await draftFollowThroughNotes({tenantId:'synthetic',userId:'am'},'touch');assert.equal(prompts.length,2);assert.equal(Object.keys(result.notes.bullets).length,6);
 outputs=[{summary:99},{summary:99}];prompts=[];
 await assert.rejects(draftFollowThroughNotes({tenantId:'synthetic',userId:'am'},'touch'),/invalid fields: summary.*existing notes were kept/);assert.equal(prompts.length,2);assert.equal(writes,0);assert.equal(touch.followThrough.notes.summary,'Previously saved AM notes.');
 console.log('PASS nullable/wrapped notes, strict action validation, one evidence-preserving repair, bounded failure and saved-note preservation');
 }finally{Module._load=original;}})().catch(error=>{console.error(error);process.exitCode=1;});
